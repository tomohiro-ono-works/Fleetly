window.CONFIG = {
  version: 2,

  // Connector（第1候補）
  connectors: [
    { id: "BQConnector", label: "BQConnector: BigQueryコネクタ" },
    { id: "CSVConnector", label: "CSVConnector: CSVコネクタ" },
    { id: "ExcelConnector", label: "ExcelConnector: Excelコネクタ" },
    { id: "OperationConnector", label: "OperationConnector: 操作コネクタ" },
    { id: "ShellConnector", label: "ShellConnector: シェル実行コネクタ" }
  ],

  // Action（Connectorに連動）
  actions: {
    BQConnector: [
      { id: "execute_sql", label: "execute_sql: SQL実行" },
      { id: "execute_sql_file", label: "execute_sql_file: SQL実行_ファイル指定" },
      { id: "load_data", label: "load_data: データロード" }
    ],
    CSVConnector: [
      { id: "read_csv", label: "read_csv: CSV読み込み" },
      { id: "write_csv", label: "write_csv: CSV書き込み" }
    ],
    ExcelConnector: [
      { id: "read_excel", label: "read_excel: Excel読み込み" },
      { id: "write_excel", label: "write_excel: Excel書き込み" }
    ],
    OperationConnector: [
      { id: "execute_rename", label: "execute_rename: 変数名変更" }
    ],
    ShellConnector: [
      { id: "execute_bat", label: "execute_bat: バッチ実行" }
    ]
  },

  // (connector.action) → フォーム定義
  forms: {
    "BQConnector.execute_sql": [
      { key:"project_id", label:"project_id: プロジェクトID", kind:"text", required:true, allowVars:true },
      { key:"sql", label:"sql: SQL文字列", kind:"textarea", required:true, allowVars:true, placeholder:"SELECT ...\nFROM ..." }
    ],

    "BQConnector.execute_sql_file": [
      { key:"project_id", label:"project_id: プロジェクトID", kind:"text", required:true, allowVars:true },
      { key:"sql_file", label:"sql_file: SQLファイルパス", kind:"file", required:true },
      { key:"encoding", label:"encoding: 文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis"] }
    ],

    "BQConnector.load_data": [
      { key:"project_id", label:"project_id: プロジェクトID", kind:"text", required:true, default:"defult_project", allowVars:true },
      { key:"dataset_id", label:"dataset_id: データセットID", kind:"text", required:true, default:"defult_dataset", allowVars:true },
      { key:"table_id", label:"table_id: テーブルID", kind:"text", required:true, default:"defult_table", allowVars:true },
      { key:"input_data", label:"input_data: 入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: ${step1}" },
      { key:"write_disposition", label:"write_disposition: 書き込みモード", kind:"combo", required:true, default:"作成または置換", options:["作成または置換","作成または挿入"] },
      { key:"schema", label:"schema: スキーマ定義", kind:"textarea", required:false, allowVars:true, placeholder:"例: [{name:\"col\", type:\"STRING\"}, ...]" }
    ],

    "CSVConnector.read_csv": [
      { key:"path", label:"path: ファイルパス", kind:"file", required:true },
      { key:"encoding", label:"encoding: 文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis","cp932"] },
      { key:"header_row", label:"header_row: ヘッダ行番号", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"data_start_row: データ開始行番号", kind:"number", required:true, default:2 },
      { key:"selected_columns", label:"selected_columns: 対象カラム", kind:"text", required:false, allowVars:true, placeholder:"例: colA,colB" }
    ],

    "CSVConnector.write_csv": [
      { key:"input_data", label:"input_data: 入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: ${step1}" },
      { key:"output_path", label:"output_path: 出力パス", kind:"file", required:true },
      { key:"encoding", label:"encoding: 文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis","cp932"] }
    ],

    "ExcelConnector.read_excel": [
      { key:"path", label:"path: ファイルパス", kind:"file", required:true },
      { key:"sheet_name", label:"sheet_name: シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"header_row", label:"header_row: ヘッダ行番号", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"data_start_row: データ開始行番号", kind:"number", required:true, default:2 }
    ],

    "ExcelConnector.write_excel": [
      { key:"input_data", label:"input_data: 入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: ${step1}" },
      { key:"output_path", label:"output_path: 出力パス", kind:"file", required:true },
      { key:"sheet_name", label:"sheet_name: シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"mode", label:"mode: 書き込みモード", kind:"combo", required:true, default:"作成または置換", options:["作成または置換","作成または挿入"] }
    ],

    "OperationConnector.execute_rename": [
      { key:"input_var", label:"input_var: 入力変数名", kind:"text", required:true, allowVars:true, placeholder:"例: ${step1}" },
      { key:"input_var_rename", label:"input_var_rename: 変更後変数名", kind:"text", required:true, placeholder:"例: step1_renamed" }
    ],

    "ShellConnector.execute_bat": [
      { key:"file_path", label:"file_path: バッチファイルパス", kind:"file", required:true },
      { key:"args", label:"args: 引数", kind:"text", required:false, allowVars:true, placeholder:"例: -x 1 -y ${step1}" }
    ]
  }
};
