(function () {
  "use strict";

  const documentState = {
    metadata: {
      mode: "dataflow",
      name: "Store fixture",
      default_flow_id: "01"
    },
    steps: [
      {
        step_id: "01",
        flow_id: "01",
        label: "Define values",
        node_type: "task",
        connector_id: "WindowsConnector",
        action_id: "define_values",
        params: { values: [] },
        schema: { columns: [] },
        ui_position: { x: 320, y: 220 }
      }
    ],
    flows: {
      "01": {
        label: "Main flow",
        start: {
          ui_position: { x: 80, y: 220 },
          variables: []
        },
        end: {
          ui_position: { x: 660, y: 220 }
        },
        edges: [
          { from: "START", to: "01", order: 1 },
          { from: "01", to: "END", order: 1 }
        ]
      }
    },
    loop: { flows: {} },
    notes: []
  };
  const changes = [];
  const errors = [];
  const commandResults = [];
  const catalog = {
    modes: {
      dataflow: {
        nodeDefaults: {
          initialConnectorId: "WindowsConnector",
          initialActionId: "define_values"
        }
      }
    },
    actions: {
      WindowsConnector: [
        {
          id: "define_values",
          label: "変数定義",
          nodeType: "task"
        },
        {
          id: "loop_tasks",
          label: "繰り返し処理",
          nodeType: "loop"
        }
      ],
      PythonConnector: [
        {
          id: "execute_python",
          label: "Python",
          nodeType: "transform"
        }
      ]
    }
  };
  const store = window.zizPackages.app.workflowDocumentStore
    .createWorkflowDocumentStore({
      document: documentState,
      doc_session_id: "docsession_01",
      document_ref: "docref_01",
      file_name: "store-fixture.zizd"
    });
  const commands = window.zizPackages.app.workflowDocumentCommands
    .createWorkflowDocumentCommands({
      store,
      catalog
    });
  const adapter = window.zizPackages.app.workflowDesignerAdapter
    .createWorkflowDesignerAdapter({
      root: document.getElementById("workflowDocumentStore"),
      store,
      commands,
      viewport: { x: 20, y: 20, zoom: 1 },
      onDocumentChange(change) {
        changes.push(change);
      },
      onError(error) {
        errors.push({
          code: String(error?.code || ""),
          message: String(error?.message || error)
        });
      },
      onCommandResult(result) {
        commandResults.push(result);
      }
    });
  adapter.mount();

  window.workflowDocumentStoreFixture = Object.freeze({
    adapter,
    commands,
    store,
    changes,
    errors,
    commandResults,
    getDocument: () => store.getDocument(),
    getSnapshot: () => store.getSnapshot(),
    clearChanges: () => {
      changes.length = 0;
      commandResults.length = 0;
      errors.length = 0;
    }
  });
})();
