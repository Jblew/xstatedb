import { actions, ActorRef, AnyState, AnyStateMachine, assign, createMachine, DoneInvokeEvent, EventObject, interpret, send, spawn } from "xstate";

type InitEvent = { type: 'INIT' }
type SaveRowEvent = { type: 'SAVE_ROW', id: string }
type DeleteRowEvent = { type: 'DELETE_ROW', id: string }
type RowFinishedEvent = { type: 'ROW_FINISHED', id: string }
type AllRowsFinishedEvent = { type: 'ALL_ROWS_FINISHED' }
type CreateRowEvent = { type: 'CREATE_ROW', machine: AnyStateMachine }
type RowInitializedEvent = { type: 'ROW_INITIALIZED', rowState: AnyState }
export type Event = DoneInvokeEvent<AnyStateMachine[]>
    | DoneInvokeEvent<AnyStateMachine>
    | InitEvent
    | RowInitializedEvent
    | SaveRowEvent
    | DeleteRowEvent
    | RowFinishedEvent
    | CreateRowEvent
    | AllRowsFinishedEvent

const context = {
    rowsRefs: {} as Record<string, ActorRef<any>>,
    tableRef: null as ActorRef<any> | null,
    saverRefs: [] as ActorRef<any>[],
    unfinishedRowsIDs: [] as string[],
    saver: async (id: string, state: AnyState) => { }
}
export type Context = typeof context

export const machine = createMachine<Context, Event>({
    initial: 'loadingTableMachine',
    context,
    states: {
        loadingTableMachine: {
            invoke: {
                src: 'loadTableMachine',
                onDone: { target: 'loadingRowsMachines', actions: 'spawnTableMachine' },
                onError: 'failed'
            }
        },
        loadingRowsMachines: {
            invoke: {
                src: 'loadRowsMachines',
                onDone: { target: 'startingTableMachine', actions: 'spawnRowsMachines' },
                onError: 'failed'
            }
        },
        startingTableMachine: {
            entry: send<Context, Event>('INIT', { to: (ctx) => ctx.tableRef! }),
            on: { always: 'executingRows' }
        },
        executingRows: {
            entry: 'sendRowsToTable',
            on: {
                SAVE_ROW: { actions: 'saveRow' },
                DELETE_ROW: { actions: ['deleteRow', 'markRowFinished'] },
                ROW_FINISHED: [
                    { actions: ['markRowFinished'] },
                    { cond: 'lastRowFinished', actions: 'sendAllRowsFinishedToTable' },
                ],
                CREATE_ROW: { actions: ['createRow', 'markRowUnfinished', 'sendCreatedRowToTable'] },
                STOP: 'done',
            },
            exit: ['stopTableMachine', 'stopRowsMachines']
        },
        failed: {
            type: 'final'
        },
        done: {
            type: 'final'
        }
    }
}, {
    guards: {
        lastRowFinished: (ctx, evt) =>
            ctx.unfinishedRowsIDs.filter(id => id != (evt as RowFinishedEvent).id)
                .length == 0
    },
    actions: {
        spawnTableMachine: assign<Context, DoneInvokeEvent<AnyStateMachine>>({
            tableRef: (_, evt) => spawn(evt.data, { sync: true }),
        }),
        spawnRowsMachines: assign<Context, DoneInvokeEvent<AnyStateMachine[]>>({
            rowsRefs: (ctx, evt) =>
                Object.assign({},
                    ctx.rowsRefs,
                    ...evt.data.map(machine => ({ [machine.id]: spawn(machine, { sync: true }) }))
                ),
            unfinishedRowsIDs: (ctx, evt) => [
                ...ctx.unfinishedRowsIDs,
                ...evt.data.map(machine => machine.id)
            ]
        }),
        sendRowsToTable: actions.pure<Context, Event>((ctx) => {
            return Object.keys(ctx.rowsRefs).map(rowID => ctx.rowsRefs[rowID])
                .map(rowRef =>
                    send<Context, RowInitializedEvent>(
                        { type: 'ROW_INITIALIZED', rowState: rowRef.getSnapshot() },
                        { to: (ctx) => ctx.tableRef! }
                    ));
        }),
        saveRow: assign<Context, SaveRowEvent>({
            saverRefs: (ctx, evt) => [
                ...ctx.saverRefs,
                spawn(ctx.saver(evt.id, ctx.rowsRefs[evt.id].getSnapshot()))
            ]
        }),
        createRow: assign<Context, CreateRowEvent>({
            rowsRefs: (ctx, evt) =>
                Object.assign({},
                    ctx.rowsRefs,
                    { [evt.machine.id]: spawn(evt.machine, { sync: true }) }
                ),
        }),
        sendCreatedRowToTable: send<Context, CreateRowEvent | RowInitializedEvent>(
            (ctx, evt) => ({ type: 'ROW_INITIALIZED', rowState: ctx.rowsRefs[(evt as CreateRowEvent).machine.id].getSnapshot() }),
            { to: (ctx) => ctx.tableRef! }
        ),
        deleteRow: actions.pure<Context, DeleteRowEvent>((_, evt) => {
            return [
                actions.stop<Context, Event>((ctx) => ctx.rowsRefs[evt.id]),
                assign<Context, DeleteRowEvent>({
                    rowsRefs: (ctx, evt) =>
                        Object.assign({},
                            ...Object.keys(ctx.rowsRefs)
                                .filter(id => id != evt.id)
                                .map(id => ({ [id]: ctx.rowsRefs[id] })),
                        ),
                }),
            ]
        }),
        markRowUnfinished: assign<Context, CreateRowEvent>({
            unfinishedRowsIDs: (ctx, evt) =>
                [
                    ...ctx.unfinishedRowsIDs,
                    evt.machine.id,
                ]
        }),
        markRowFinished: assign<Context, RowFinishedEvent | DeleteRowEvent>({
            unfinishedRowsIDs: (ctx, evt) =>
                ctx.unfinishedRowsIDs.filter(id => id != evt.id)
        }),
        sendAllRowsFinishedToTable: send<Context, AllRowsFinishedEvent>(
            { type: 'ALL_ROWS_FINISHED' },
            { to: (ctx) => ctx.tableRef! }
        ),
        stopTableMachine: actions.stop<Context, Event>((ctx) => ctx.tableRef!),
        stopRowsMachines: actions.pure<Context, Event>((ctx) => {
            return Object.keys(ctx.rowsRefs).map(rowID => ctx.rowsRefs[rowID])
                .map(rowRef => actions.stop<Context, Event>(rowRef.id));
        }),
    }
})