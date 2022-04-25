export interface XStateDBStorage {
    store(id: string, state: object): Promise<void>
    exists(id: string): Promise<boolean>
    read(id: string): Promise<object>
    delete(id: string): Promise<void>
    getAllIDs(): Promise<string[]>
}