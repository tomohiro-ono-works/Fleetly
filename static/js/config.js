window.CONFIG = {
  version: 3,

  connectors: [
    { id: "BQConnector",        label: "BigQuery", exportId: "bigquery_connector" },
    { id: "CSVConnector",       label: "CSV", exportId: "csv_connector" },
    { id: "ExcelConnector",     label: "Excel", exportId: "excel_connector" },
    { id: "PlotlyConnector",    label: "Plotly", exportId: "plotly_connector" },
    { id: "PPTConnector",       label: "PowerPoint", exportId: "ppt_connector" },
    { id: "OperationConnector", label: "操作", exportId: "operation_connector" },
    { id: "DataintegrationConnector", label: "データ加工", exportId: "dataintegration_connector" },
    { id: "ShellConnector",     label: "シェル", exportId: "shell_connector" },
    { id: "VectorConnector",    label: "VectorDB", exportId: "vector_connector" },
    { id: "LLMConnector",       label: "LLM", exportId: "llm_connector" },
    { id: "WebConnector",       label: "Web操作", exportId: "web_connector" },
    { id: "APIConnector",       label: "API実行", exportId: "api_connector" },
    { id: "PythonConnector",    label: "Python実行", exportId: "python_connector" }
  ],

  actions: {
    BQConnector: [
      { id: "execute_sql",      label: "SQL実行" },
      { id: "execute_sql_file", label: "SQL実行（ファイル）" },
      { id: "load_data",        label: "データロード" }
    ],
    CSVConnector: [
      { id: "read_csv",  label: "読み込み" },
      { id: "write_csv", label: "書き込み" }
    ],
    ExcelConnector: [
      {
        id: "read_excel",
        label: "読み込み",
        detailModal: {
          type: "excel",
          label: "Excelモーダルを開く",
          resultFieldMap: {
            fileName: "file_path",
            sheetName: "sheet_name",
            headerRow: "header_row",
            dataStartRow: "data_start_row"
          }
        }
      },
      { id: "write_excel", label: "書き込み" },
      { id: "read_excel_range",  label: "エリア指定読み込み" }
    ],
    PlotlyConnector: [
      { id: "plot_combined_bar_line", label: "棒＋折れ線グラフ" },
      { id: "plot_stacked_bar", label: "積み上げ棒グラフ" },
      { id: "plot_scorecard", label: "スコアカード" },
      { id: "plot_funnel", label: "ファネルチャート" },
      { id: "plot_radar", label: "レーダーチャート" }
    ],
    OperationConnector: [
      { id: "define_values", label: "変数定義" },
      { id: "loop_tasks", label: "繰り返し処理" },
      { id: "get_files", label: "フォルダ内のファイルを取得" },
      { id: "rename_files", label: "ファイル名を変更" },
      { id: "execute_move", label: "ファイル移動" }
    ],
    DataintegrationConnector: [
      { id: "filter_fields", label: "列指定" },
      { id: "filter_fields", label: "条件指定" },
      { id: "rename_fields", label: "フィールド名変更" },
      { id: "rename_field_list", label: "フィールド名をリストで変更" },
      { id: "pivot_axis", label: "ピボット処理" }
    ],
    ShellConnector: [
      { id: "execute_bat", label: "バッチ実行" }
    ],
    VectorConnector: [
      { id: "embedding_vector_db", label: "ベクトルDB構築" },
      { id: "search_vector_db", label: "ベクトル検索" }
    ],
    LLMConnector: [
      { id: "execute_prompt", label: "プロンプト実行" }
    ],
    PPTConnector: [
      { id: "slide_insert_value", label: "スライド値挿入" },
      { id: "slide_insert_image", label: "スライド画像添付" }
    ],
    WebConnector: [
      { id: "lookat_pages", label: "ページを開く" },
      { id: "lookat_page", label: "要素の取得" },
      { id: "click_to_web_object", label: "クリック" },
      { id: "click_to_web_object", label: "JavaScript実行" },
      { id: "click_to_web_object", label: "クリック" },
      { id: "click_to_web_object", label: "クリック" }
    ],
    APIConnector: [
      { id: "run_api", label: "API実行" }
    ],
    PythonConnector: [
      { id: "execute_python", label: "Python実行" }
    ]
  },

  forms: {
    "BQConnector.execute_sql": [
      { key:"project_id", label:"プロジェクト", kind:"combo", default:"defult_project", options:["defult_project","defult_project2"], required:true},
      { key:"sql", label:"SQL", kind:"textarea", required:true, allowVars:true, placeholder:"SELECT ...\nFROM ..." }
    ],

    "BQConnector.execute_sql_file": [
      { key:"project_id", label:"プロジェクト", kind:"combo", default:"defult_project", options:["defult_project","defult_project2"], required:true},
      { key:"sql_file", label:"SQLファイル", kind:"file", required:true },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis"] }
    ],
    
    "BQConnector.load_data": [
      { key:"project_id", label:"プロジェクト", kind:"combo", default:"defult_project", options:["defult_project","defult_project2"], required:true},
      { key:"dataset_id", label:"データセット", kind:"combo", default:"defult_dataset", options:["defult_dataset","defult_dataset2"], required:true},
      { key:"table_id", label:"テーブル", kind:"text", required:true, default:"defult_table", allowVars:true },
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"write_disposition", label:"書き込みモード", kind:"combo", required:true, default:"create_or_replace", options:["create_or_replace","create_or_insert"] },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "CSVConnector.read_csv": [
      { key:"file_path", label:"ファイル", kind:"file", required:true },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis","cp932"] },
      { key:"header_row", label:"ヘッダ行", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"データ開始行", kind:"number", required:true, default:2 },
      { key:"selected_columns", label:"対象カラム", kind:"text", required:false, allowVars:true }
    ],

    "CSVConnector.write_csv": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"output_path", label:"出力ファイル", kind:"file", required:true },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis","cp932"] }
    ],

    "ExcelConnector.read_excel": [
      { key:"file_path", label:"ファイル", kind:"file", required:true },
      { key:"sheet_name", label:"シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"header_row", label:"ヘッダ行", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"データ開始行", kind:"number", required:true, default:2 }
    ],

    "ExcelConnector.write_excel": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"output_path", label:"出力ファイル", kind:"file", required:true },
      { key:"sheet_name", label:"シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"mode", label:"書き込みモード", kind:"combo", required:true, default:"create_or_replace", options:["create_or_replace","create_or_insert"] }
    ],

    "PlotlyConnector.plot_combined_bar_line": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"x_col", label:"X列", kind:"text", required:true, allowVars:true },
      { key:"bar_col", label:"棒グラフ列", kind:"text", required:true, allowVars:true },
      { key:"line_col", label:"折れ線列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"棒グラフ＋折れ線グラフ" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"combined_bar_line", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_stacked_bar": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"x_col", label:"X列", kind:"text", required:true, allowVars:true },
      { key:"y_cols", label:"積み上げ列", kind:"text", required:true, allowVars:true, placeholder:"例: cost,profit" },
      { key:"is_percent", label:"100%積み上げ", kind:"combo", required:false, default:"", options:["","1"] },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"積み上げ棒グラフ" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"stacked_bar", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_scorecard": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"value_col", label:"値列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"スコアカード" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"scorecard", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_funnel": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"stage_col", label:"ステージ列", kind:"text", required:true, allowVars:true },
      { key:"value_col", label:"値列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"ファネルチャート" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"funnel", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_radar": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {step1}" },
      { key:"value_cols", label:"値列（カンマ区切り）", kind:"text", required:true, allowVars:true, placeholder:"例: sales,profit,cost" },
      { key:"name", label:"系列名", kind:"text", required:false, allowVars:true, default:"series" },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"レーダーチャート" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"radar", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "OperationConnector.execute_rename": [
      { key:"input_var", label:"入力変数", kind:"combo", required:true, allowVars:true, options:[] }, // optionsは renderer で上流から注入
      { key:"input_var_rename", label:"変更後変数名", kind:"text", required:true, placeholder:"例: step1_renamed" }
    ],

    "ShellConnector.execute_bat": [
      { key:"file_path", label:"バッチファイル", kind:"file", required:true },
      { key:"args", label:"引数", kind:"text", required:false, allowVars:true }
    ]
  }
};
