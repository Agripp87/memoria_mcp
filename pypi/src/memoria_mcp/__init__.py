"""Name reservation for Memoria — persistent, plain-text memory for Claude over MCP.

The Memoria server is a Node application and is NOT distributed through PyPI.
This package exists to hold the name and to point at the real project rather
than leaving importers guessing.

    https://github.com/Agripp87/memoria_mcp
"""

__version__ = "0.0.2"

PROJECT_URL = "https://github.com/Agripp87/memoria_mcp"

__all__ = ["__version__", "PROJECT_URL"]


def where() -> str:
    """Return a human-readable pointer to the real project."""
    return (
        "Memoria's server is a Node application, not a Python package.\n"
        f"Project and install instructions: {PROJECT_URL}\n"
        "Claude Code plugin:  /plugin marketplace add Agripp87/memoria_mcp"
    )
