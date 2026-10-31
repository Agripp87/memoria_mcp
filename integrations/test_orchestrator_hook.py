"""Unit tests for the Python ingestion hook's buffer behaviour.

Run: python -m pytest integrations/test_orchestrator_hook.py
Covers the re-queue-on-failure path that previously had only a
`compileall` syntax check in CI.
"""
import json
import os
import sys
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from orchestrator_hook import MemoriaHook  # noqa: E402


def make_hook(max_buffer=3):
    return MemoriaHook(
        memoria_url="http://127.0.0.1:9/ingest",
        api_key="test",
        max_buffer=max_buffer,
        flush_interval=0,
    )


def event(i):
    return {"id": f"e{i}", "source": "t", "content": f"event {i}"}


def test_failed_flush_requeues_at_front_in_order():
    hook = make_hook()
    hook._buffer = [event(1), event(2)]
    hook._send = lambda events: (_ for _ in ()).throw(RuntimeError("down"))
    result = hook.flush()
    assert "error" in result
    assert [e["id"] for e in hook._buffer] == ["e1", "e2"]


def test_failed_flush_caps_buffer_at_2x_dropping_oldest():
    hook = make_hook(max_buffer=2)
    hook._buffer = [event(i) for i in range(5)]
    hook._send = lambda events: (_ for _ in ()).throw(RuntimeError("down"))
    hook.flush()
    assert len(hook._buffer) == 4  # 2 * max_buffer
    assert hook._buffer[0]["id"] == "e1"  # oldest dropped


def test_successful_flush_clears_buffer():
    hook = make_hook()
    hook._buffer = [event(1)]
    hook._send = lambda events: {"accepted": len(events)}
    assert hook.flush() == {"accepted": 1}
    assert hook._buffer == []


def test_empty_flush_is_a_noop():
    hook = make_hook()
    assert hook.flush() == {"accepted": 0}


class _HTTPError(Exception):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.response = type("R", (), {"status_code": status})()


def test_client_errors_are_dropped_not_retried_forever():
    hook = make_hook()
    hook._buffer = [event(1), event(2)]

    def reject(events):
        raise _HTTPError(401)

    hook._send = reject
    result = hook.flush()
    assert result["dropped"] == 2
    assert hook._buffer == []


def test_rate_limits_and_server_errors_are_retried():
    for status in (429, 503):
        hook = make_hook()
        hook._buffer = [event(1)]

        def fail(events, status=status):
            raise _HTTPError(status)

        hook._send = fail
        hook.flush()
        assert [e["id"] for e in hook._buffer] == ["e1"]


def test_recording_never_waits_on_a_slow_send():
    import threading
    import time

    hook = make_hook(max_buffer=2)
    release = threading.Event()

    def slow_send(events):
        release.wait(5)
        return {"accepted": len(events)}

    hook._send = slow_send
    hook._push(event(1))
    hook._push(event(2))  # fills the buffer: a background flush starts
    started = time.monotonic()
    for i in range(3, 10):
        hook._push(event(i))  # must not block behind the in-flight send
    assert time.monotonic() - started < 1.0
    release.set()


def test_large_buffers_are_sent_in_chunks_the_server_accepts():
    hook = make_hook(max_buffer=500)
    hook._buffer = [event(i) for i in range(450)]
    sizes = []

    def send(events):
        if len(events) > 200:
            raise _HTTPError(400)  # what /ingest answers to more than 200
        sizes.append(len(events))
        return {"accepted": len(events)}

    hook._send = send
    result = hook.flush()
    assert sizes == [200, 200, 50]
    assert result["accepted"] == 450
    assert hook._buffer == []


def test_an_outage_mid_flush_requeues_the_rest_in_order():
    hook = make_hook(max_buffer=500)
    hook._buffer = [event(i) for i in range(450)]
    calls = []

    def send(events):
        calls.append(len(events))
        if len(calls) == 2:
            raise _HTTPError(503)
        return {"accepted": len(events)}

    hook._send = send
    hook.flush()
    assert [e["id"] for e in hook._buffer][:2] == ["e200", "e201"]
    assert len(hook._buffer) == 250


def strict_send(received):
    """A _send that serializes the way the real one does and parses the way
    /ingest does: strict JSON, no NaN or Infinity tokens."""

    def send(events):
        body = json.dumps({"events": events}, allow_nan=False)
        received.extend(json.loads(body)["events"])
        return {"accepted": len(events)}

    return send


def test_a_nan_value_does_not_cost_the_rest_of_the_batch():
    # A NaN went out as a bare token: /ingest answered 400, and the 4xx
    # branch dropped all 200 events of the batch.
    hook = make_hook(max_buffer=1000)
    for i in range(199):
        hook.record_metric(f"a{i}", True, 12.0, 0.01)
    hook.record_metric("nan", True, float("nan"), 0.01)
    received = []
    hook._send = strict_send(received)
    hook.flush()
    assert len(received) == 200
    bad = [e for e in received if e["meta"]["agent_id"] == "nan"]
    assert bad[0]["meta"]["response_time_ms"] is None


def test_a_decimal_value_does_not_stall_the_queue():
    # A Decimal made json.dumps raise TypeError before sending, which counted
    # as an outage: the batch was re-queued, and failed again on every flush.
    class UserId:
        def __str__(self):
            return "user-7"

    hook = make_hook(max_buffer=1000)
    hook.record_metric("a", True, Decimal("12.5"), Decimal("0.01"), user_id=UserId())
    for i in range(50):
        hook.record_metric(f"b{i}", True, 1.0, 0.0)
    received = []
    hook._send = strict_send(received)
    hook.flush()
    assert hook._buffer == []
    assert len(received) == 51
    meta = received[0]["meta"]
    assert meta["response_time_ms"] == 12.5
    assert meta["user_id"] == "user-7"


def test_an_event_that_cannot_be_serialized_is_dropped_alone():
    hook = make_hook(max_buffer=1000)
    hook._push({"id": "bad", "meta": {("tuple", "key"): 1}})
    hook._push(event(1))
    assert [e["id"] for e in hook._buffer] == ["e1"]


def test_numpy_values_are_sent_as_plain_numbers():
    np = pytest.importorskip("numpy")
    hook = make_hook(max_buffer=1000)
    hook.record_metric(
        "a", np.bool_(True), np.float32(2.5), np.float64("nan"), user_id=np.int64(7)
    )
    received = []
    hook._send = strict_send(received)
    hook.flush()
    assert received[0]["meta"] == {
        "agent_id": "a",
        "success": True,
        "response_time_ms": 2.5,
        "cost_usd": None,
        "user_id": 7,
        "routing_confidence": None,
    }
