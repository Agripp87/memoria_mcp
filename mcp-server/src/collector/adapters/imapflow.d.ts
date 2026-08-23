declare module "imapflow" {
  export class ImapFlow {
    constructor(options: any);
    connect(): Promise<void>;
    getMailboxLock(mailbox: string): Promise<{ release(): void }>;
    fetch(range: string, options: any): AsyncIterable<any>;
    logout(): Promise<void>;
  }
}
