(function () {
  "use strict";

  const variant = new URLSearchParams(window.location.search)
    .get("variant") === "classic"
    ? "classic"
    : "current";
  const api = variant === "classic"
    ? window.zizPackages.classicWorkflowDesigner
    : window.zizPackages.workflowDesigner;
  const root = document.getElementById("workflowDesigner");
  const events = [];
  let documentState = {
    metadata: {
      mode: "dataflow",
      name: "WorkflowDesigner fixture",
      default_flow_id: "01"
    },
    steps: [
      {
        step_id: "01",
        flow_id: "01",
        label: "Customer file",
        node_type: "data",
        connector_id: "csv_connector",
        action_id: "read_csv",
        ui_position: { x: 280, y: 120 }
      },
      {
        step_id: "02",
        flow_id: "01",
        label: "Order file",
        node_type: "data",
        connector_id: "excel_connector",
        action_id: "read_excel",
        ui_position: { x: 280, y: 260 }
      },
      {
        step_id: "03",
        flow_id: "01",
        label: "Filter sales",
        node_type: "transform",
        connector_id: "data_connector",
        action_id: "filter",
        ui_position: { x: 540, y: 190 }
      },
      {
        step_id: "04",
        flow_id: "01",
        label: "Repeat rows",
        node_type: "loop",
        connector_id: "workflow_connector",
        action_id: "loop",
        ui_position: { x: 790, y: 190 }
      },
      {
        step_id: "05",
        flow_id: "02",
        label: "Define values",
        node_type: "task",
        connector_id: "windows_connector",
        action_id: "define_values",
        ui_position: { x: 300, y: 650 }
      },
      {
        step_id: "06",
        flow_id: "01",
        label: "Normalize row",
        node_type: "transform",
        loop_owner_id: "04",
        connector_id: "python_connector",
        action_id: "execute_python",
        ui_position: { x: 720, y: 350 }
      },
      {
        step_id: "07",
        flow_id: "01",
        label: "Validate row",
        node_type: "transform",
        loop_owner_id: "04",
        connector_id: "python_connector",
        action_id: "execute_python",
        ui_position: { x: 950, y: 350 }
      },
      {
        step_id: "10",
        label: "Pasted source",
        node_type: "data",
        connector_id: "csv_connector",
        action_id: "read_csv",
        ui_position: { x: 310, y: 900 }
      },
      {
        step_id: "11",
        label: "Pasted filter",
        node_type: "transform",
        connector_id: "data_connector",
        action_id: "filter",
        ui_position: { x: 560, y: 900 }
      }
    ],
    flows: {
      "01": {
        label: "Sales preparation",
        start: {
          ui_position: { x: 80, y: 205 },
          variables: []
        },
        end: {
          ui_position: { x: 1240, y: 205 }
        },
        edges: [
          { from: "START", to: "01", order: 1 },
          { from: "START", to: "02", order: 2 },
          { from: "01", to: "03", order: 0 },
          { from: "02", to: "03", order: 0 },
          { from: "03", to: "04", order: 1 },
          { from: "04", to: "END", order: 1 }
        ]
      },
      "02": {
        label: "Automation",
        start: {
          ui_position: { x: 80, y: 664 },
          variables: []
        },
        end: {
          ui_position: { x: 600, y: 664 }
        },
        edges: [
          { from: "START", to: "05", order: 1 },
          { from: "05", to: "END", order: 1 }
        ]
      }
    },
    unassigned: {
      start: {
        ui_position: { x: 80, y: 914 }
      },
      step_ids: ["10", "11"],
      edges: [
        { from: "START", to: "10", order: 1 },
        { from: "10", to: "11", order: 1 }
      ]
    },
    loop: {
      flows: {
        "04": {
          edges: [
            { from: "START", to: "06", order: 1 },
            { from: "06", to: "07", order: 1 },
            { from: "07", to: "END", order: 1 }
          ]
        }
      }
    },
    notes: [
      {
        note_id: "01",
        ui_position: { x: 820, y: 610 },
        size: { width: 250, height: 150 },
        text: "Review the output\nhttps://example.com/docs",
        color: "#fff4bf"
      }
    ]
  };

  const catalog = {
    connectors: [
      { id: "csv_connector", label: "CSV" },
      { id: "excel_connector", label: "Excel" },
      { id: "data_connector", label: "Data" },
      { id: "workflow_connector", label: "Workflow" },
      { id: "windows_connector", label: "Windows" },
      { id: "python_connector", label: "Python" }
    ],
    actions: {
      csv_connector: [
        { id: "read_csv", label: "Read CSV", nodeType: "data" }
      ],
      excel_connector: [
        { id: "read_excel", label: "Read Excel", nodeType: "data" }
      ],
      data_connector: [
        { id: "filter", label: "Filter", nodeType: "transform" }
      ],
      workflow_connector: [
        { id: "loop", label: "Loop", nodeType: "loop" }
      ],
      windows_connector: [
        { id: "define_values", label: "Define values", nodeType: "task" }
      ],
      python_connector: [
        { id: "execute_python", label: "Python", nodeType: "transform" }
      ]
    }
  };
  const nodeRenderers = window.zizPackages.app.workflowDesignerRenderers
    .createZizaiNodeRenderers({ catalog });

  const designer = api.createWorkflowDesigner({
    root,
    document: documentState,
    viewport: { x: 30, y: 30, zoom: 0.82 },
    nodeRenderers,
    noteColors: ["#fff4bf"],
    graphConstraints({ sourceNodeRef, targetNodeRef }) {
      if (sourceNodeRef.node_id === "02") {
        return {
          allowed: false,
          message: "This source is blocked by the fixture constraint."
        };
      }
      if (
        sourceNodeRef.loop_owner_id &&
        sourceNodeRef.loop_owner_id !== targetNodeRef.loop_owner_id
      ) {
        return {
          allowed: false,
          message: "Loop boundary connections are disabled in this fixture."
        };
      }
      return { allowed: true };
    }
  });

  designer.on("document:change", (event) => {
    events.push({ name: "document:change", payload: event });
    documentState = api.applyDocumentPatch(documentState, event.patch);
    designer.updateDocument(event.patch);
  });
  [
    "selection:change",
    "viewport:change",
    "node:open-detail",
    "command:execute",
    "connect:create-request",
    "delete:request",
    "run:request",
    "external-link:open-request"
  ].forEach((eventName) => {
    designer.on(eventName, (payload) => {
      events.push({ name: eventName, payload });
    });
  });

  designer.mount();
  designer.setStatus({
    nodeStatus: {
      "01": "success",
      "04": "running"
    },
    validation: {
      "10": [
        {
          level: "error",
          message: "Assign this graph to a flow before running."
        }
      ]
    }
  });

  window.workflowDesignerFixture = Object.freeze({
    variant,
    designer,
    events,
    getDocument: () => JSON.parse(JSON.stringify(documentState)),
    replaceDocument(value) {
      documentState = JSON.parse(JSON.stringify(value));
      designer.setDocument(documentState);
    },
    clearEvents: () => {
      events.length = 0;
    }
  });
})();
