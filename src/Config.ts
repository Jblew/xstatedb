import { AnyStateMachine } from "xstate";
import { XStateDBStorage } from "./interfaces";

export interface Config {
    tableMachine: AnyStateMachine,
    rowMachine: AnyStateMachine,
    storage: XStateDBStorage,
    timeoutMs: number
}