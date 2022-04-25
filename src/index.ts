import { Config } from "./Config";
import { waitFor } from 'xstate/lib/waitFor'
import { actions, ActorRef, AnyInterpreter, AnyState, AnyStateMachine, assign, createMachine, DoneInvokeEvent, EventObject, interpret, send, spawn } from "xstate";
import { machine } from "./machine";
type InitEvent = { type: 'INIT' }
type SaveRowEvent = { type: 'SAVE_ROW', id: string }
type DeleteRowEvent = { type: 'DELETE_ROW', id: string }
type RowFinishedEvent = { type: 'ROW_FINISHED', id: string }
type AllRowsFinishedEvent = { type: 'ALL_ROWS_FINISHED' }
type CreateRowEvent = { type: 'CREATE_ROW', machine: AnyStateMachine }
type RowInitializedEvent = { type: 'ROW_INITIALIZED', rowState: AnyState }
type Event = DoneInvokeEvent<AnyStateMachine[]>
    | DoneInvokeEvent<AnyStateMachine>
    | InitEvent
    | RowInitializedEvent
    | SaveRowEvent
    | DeleteRowEvent
    | RowFinishedEvent
    | CreateRowEvent
    | AllRowsFinishedEvent

export class XStateDB {
    private interpreter: ReturnType<typeof this.interpretMachine>

    constructor(private config: Config) {
        //
    }

    async start(): Promise<void> {
        this.interpreter = this.interpretMachine(this.createMachine())
        this.interpreter.start()
        return this.waitForInterpreter(this.interpreter)
    }

    private createMachine() {
        return machine
            .withContext({
                ...machine.context,
                saver: (id: string, state: AnyState) => this.config.storage.store(id, state)
            })
            .withConfig({
                services: {
                    loadTableMachine,
                    loadRowsMachines
                }
            })
    }

    private interpretMachine(machine: ReturnType<typeof this.createMachine>) {
        return interpret(machine)
    }

    private async waitForInterpreter(interpreter: AnyInterpreter): Promise<void> {
        await waitFor(
            interpreter,
            (state: AnyState) => state.done == true,
            { timeout: 10 * 1000 }
        )
    }
}