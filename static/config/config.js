project_options=["defult_project1","defult_project2"]
dataset_options=["defult_dataset1","defult_dataset2"]
pyenv_options=["defult","venv1","venv2"]
python_path=["xxxxxxx/xxxxxx/xxxxxxx"]
ziz_path=["yyyyyy/yyyyyy/yyyyyy/main.py"]
csv_encoding_options=["utf8","shift_jis","cp932"]
csv_delimiter_options=[
  { value:",", label:"カンマ (,)" },
  { value:"\\t", label:"タブ (TAB)" },
  { value:";", label:"セミコロン (;)" },
  { value:"|", label:"パイプ (|)" }
]
date_field_mode_options=[
  { value:"speed", label:"スピード優先" },
  { value:"cleansing", label:"クレンジング優先" }
]
const CONFIG = {
  version: 3,

  modes: {
    // dataflow: {
    //   id: "dataflow",
    //   label: "ワークフロー",
    //   defaultFlowName: "ワークフロー１",
    //   fileExtension: ".zizw",
    //     connectorIds: [
    //       "DataflowConnector",
    //       "DummyConnector",

    //       "ExcelConnector",
    //       "WindowsConnector",
    //       "WebConnector",
    //       "APIConnector",
    //       "RpaSlackConnector",
    //     ]
    // },
    dataflow: {
      id: "dataflow",
      label: "データフロー",
      defaultFlowName: "データフロー１",
      fileExtension: ".zizd",
      nodeDefaults: {
        initialConnectorId: "OperationConnector",
        initialActionId: "define_values",
        preferredConnectorId: "BQConnector",
        preferredActionId: "execute_sql",
        loopConnectorId: "OperationConnector",
        loopActionId: "loop_tasks"
      },
        connectorIds: [
          "BQConnector",
          "DummyConnector",
          "ExcelConnector",
          "CSVConnector",
          "APIConnector",
          "PythonConnector",
          "DataintegrationConnector",
          "VectorConnector",
          "WindowsConnector",
          "WebConnector",
          "RpaSlackConnector",
          "OperationConnector",
          "PlotlyConnector",
          "PPTConnector",
          "OutlookConnector"
        ]
    },
    "query-builder": {
      id: "query-builder",
      label: "クエリビルダー",
      defaultFlowName: "クエリビルダー１",
      fileExtension: ".zizq",
      nodeDefaults: {
        initialConnectorId: "BQConnector",
        initialActionId: "execute_sql",
        preferredConnectorId: "BQConnector",
        preferredActionId: "execute_sql"
      },
      connectorIds: [
        "BQConnector"
      ]
    }
  },

  connectors: [
    { id: "DummyConnector",           label: "ダミー", exportId: "dummy_connector", icon: "./icons/chess_pawn.svg"},
    { id: "BQConnector",              label: "BigQuery", exportId: "bigquery_connector"},
    { id: "ExcelConnector",           label: "Excel", exportId: "excel_connector"},
    { id: "CSVConnector",             label: "CSV", exportId: "csv_connector"},
    { id: "PythonConnector",          label: "Python実行", exportId: "python_connector"},
    { id: "RpaSlackConnector",        label: "Slack操作", exportId: "rpa_slack_connector"},
    { id: "OutlookConnector",         label: "Outlook", exportId: "outlook_connector"},
    { id: "WebConnector",             label: "Web操作", exportId: "web_connector", icon: "./icons/web.svg"},
    { id: "WindowsConnector",             label: "Windows操作", exportId: "windows_connector"},

    { id: "PlotlyConnector",          label: "Plotly", exportId: "plotly_connector" },
    { id: "PPTConnector",             label: "PowerPoint", exportId: "ppt_connector" },
    { id: "OperationConnector",       label: "操作", exportId: "operation_connector"},
    { id: "DataintegrationConnector", label: "データ加工", exportId: "dataintegration_connector", category: "data", icon: "./icons/brick.svg"},
    { id: "VectorConnector",          label: "VectorDB", exportId: "vector_connector", icon: "./icons/vectordb.svg"},
    { id: "APIConnector",             label: "API実行", exportId: "api_connector"},

  ],

  actions: {
    DataflowConnector: [
      { id: "run_dataflow", label: "データフロー実行", rpaType: "Transform" }
    ],
    DummyConnector: [
      { id: "show_connector_icon", label: "コネクタ画像選択", rpaType: "Transform" }
    ],
    BQConnector: [
      { id: "execute_sql",      label: "SQL実行" , rpaType: "Extract"},
      { id: "execute_sql_file", label: "SQL実行（ファイル）" , rpaType: "Extract"},
      { id: "load_data",        label: "データロード" , rpaType: "Load"}
    ],
    CSVConnector: [
      {
        id: "read_csv",
        label: "読み込み",
        rpaType: "Extract",
        detailModal: {
          type: "csv",
          label: "ファイルを開く",
          resultFieldMap: {
            fileName: "file_path",
            encoding: "encoding",
            delimiter: "delimiter",
            headerRow: "header_row",
            dataStartRow: "data_start_row",
            schema: "schema"
          }
        }
      },
      { id: "write_csv", label: "書き込み" , rpaType: "Load"}
    ],
    ExcelConnector: [
      {
        id: "read_excel",
        label: "読み込み",
        rpaType: "Extract",
        detailModal: {
          type: "excel",
          label: "ファイルを開く",
          resultFieldMap: {
            fileName: "file_path",
            sheetName: "sheet_name",
            headerRow: "header_row",
            dataStartRow: "data_start_row",
            schema: "schema"
          }
        }
      },
      { id: "write_excel", label: "書き込み" , rpaType: "Load"},
      { id: "read_excel_range",  label: "エリア指定読み込み", rpaType: "Extract" }
    ],
    PlotlyConnector: [
      { id: "plot_combined_bar_line", label: "棒＋折れ線グラフ", rpaType: "Load" },
      { id: "plot_stacked_bar", label: "積み上げ棒グラフ" , rpaType: "Load"},
      { id: "plot_scorecard", label: "スコアカード" , rpaType: "Load"},
      { id: "plot_funnel", label: "ファネルチャート", rpaType: "Load" },
      { id: "plot_radar", label: "レーダーチャート", rpaType: "Load" }
    ],
    OperationConnector: [
      { id: "define_values", label: "変数定義" , rpaType: "Transform"},
      { id: "loop_tasks", label: "繰り返し処理" , rpaType: "Transform", nodeType: "loop" },
      { id: "get_files", label: "フォルダ内のファイルを取得" , rpaType: "Transform" },
      { id: "rename_files", label: "ファイル名を変更" , rpaType: "Transform"},
      { id: "execute_move", label: "ファイル移動" , rpaType: "Transform"}
    ],
    DataintegrationConnector: [
      { id: "replace_fields_forrenamelist", label: "フィールド名をRENAMEリストから変更" , rpaType: "Transform"},
      { id: "filter_rows", label: "条件指定" , rpaType: "Transform"}
    ],
    ShellConnector: [
      { id: "execute_bat", label: "バッチ実行" , rpaType: "Transform"}
    ],
    VectorConnector: [
      { id: "embedding_vector_db", label: "ベクトルDB構築" , rpaType: "Load"},
      { id: "search_vector_db", label: "ベクトル検索" , rpaType: "Extract"}
    ],
    LLMConnector: [
      { id: "execute_prompt", label: "プロンプト実行" , rpaType: "Transform"}
    ],
    PPTConnector: [
      { id: "slide_insert_value", label: "スライド値挿入" , rpaType: "Load"},
      { id: "slide_insert_image", label: "スライド画像添付" , rpaType: "Load"}
    ],
    WebConnector: [
      { id: "open_chrome_page", label: "Chromeで開く" , rpaType: "Transform"},
      { id: "easy_get_element", label: "イージー要素取得" , rpaType: "Extract"},
      { id: "easy_click_element", label: "イージークリック" , rpaType: "Transform"},
      { id: "lookat_pages", label: "ページを開く" , rpaType: "Transform"},
      { id: "lookat_page", label: "要素の取得" , rpaType: "Transform"},
      { id: "click_to_web_object", label: "クリック" , rpaType: "Transform"},
      { id: "click_to_web_object", label: "JavaScript実行" , rpaType: "Transform"},
      { id: "click_to_web_object", label: "クリック" , rpaType: "Transform"},
      { id: "click_to_web_object", label: "クリック" , rpaType: "Transform"}
    ],
    APIConnector: [
      { id: "run_api", label: "API実行" , rpaType: "Transform"}
    ],
    PythonConnector: [
      { id: "execute_python", label: "Python実行" , rpaType: "Transform"}
    ],
    RpaSlackConnector: [
      { id: "move_channel", label: "チャンネル移動" , rpaType: "Transform"},
      { id: "delete_draft", label: "下書き削除" , rpaType: "Transform"},
      { id: "write_draft", label: "下書き入力" , rpaType: "Transform"},
      { id: "get_chrome_info", label: "Chrome情報取得" , rpaType: "Extract"}
    ],
    WindowsConnector: [
      { id: "rename_and_move_file", label: "ファイル名変更＆移動", rpaType: "Transform" },
      { id: "search_files_by_name", label: "ファイル名検索", rpaType: "Extract" },
      { id: "search_text_in_files", label: "ファイル内の文字列検索", rpaType: "Extract" },
      { id: "create_markdown_file", label: "マークダウンを作成", rpaType: "Load" }
    ],
    OutlookConnector: [
      { id: "search_mail", label: "メール検索" , rpaType: "Extract"},
      { id: "download_attachments", label: "添付ファイル保存" , rpaType: "Load"},
      { id: "send_mail", label: "メール送信" , rpaType: "Load"}
    ]
  },

  forms: {
    "DataflowConnector.run_dataflow": [
      { key:"dataflow_path", label:"データフローファイル", kind:"file", required:true },
      { key:"input_variables", label:"入力変数", kind:"textarea", required:false, allowVars:true, placeholder:"例: {\"target_month\": \"{{target_month}}\"}" }
    ],

    "DummyConnector.show_connector_icon": [
      {
        key:"selected_connector_icon",
        label:"コネクタ画像",
        kind:"combo",
        required:true,
        allowCustom:false,
        default:"DataflowConnector",
        options:[
          { value:"DataflowConnector", label:"データフロー", image:"./icons/dataflow.svg" },
          { value:"DummyConnector", label:"ダミー", image:"./icons/chess_pawn.svg" },
            { value:"DataintegrationConnector", label:"データ加工", image:"./icons/brick.svg" },
            { value:"VectorConnector", label:"VectorDB", image:"./icons/vectordb.svg" },
            { value:"WebConnector", label:"Web操作", image:"./icons/web.svg" },
            { value:"APIConnector", label:"API実行", image:"./icons/web.svg" },
            { value:"ExcelConnector", label:"Excel", image:"./img/ExcelConnector.jpg" },
            { value:"BQConnector", label:"BigQuery", image:"./img/BQConnector.jpg" }
          ]
        }
      ],

    "BQConnector.execute_sql": [
      { key:"google_auth", label:"認証", kind:"google-auth-login", buttonLabel:"Googleログイン" },
      { key:"project_id", label:"プロジェクト", kind:"combo", default:project_options[0], options:project_options, required:true},
      { key:"sql", label:"SQL", kind:"textarea", codeLanguage:"sql", required:true, allowVars:true, placeholder:"SELECT ...\nFROM ..." },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true, schema_autoextract:true }
    ],

    "BQConnector.execute_sql_file": [
      { key:"google_auth", label:"認証", kind:"google-auth-login", buttonLabel:"Googleログイン" },
      { key:"project_id", label:"プロジェクト", kind:"combo", default:project_options[0], options:project_options, required:true},
      { key:"sql_file", label:"SQLファイル", kind:"file", required:true },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis"] }
    ],
    
    "BQConnector.load_data": [
      { key:"google_auth", label:"認証", kind:"google-auth-login", buttonLabel:"Googleログイン" },
      { key:"project_id", label:"プロジェクト", kind:"combo", default:project_options[0], options:project_options, required:true},
      { key:"dataset_id", label:"データセット", kind:"combo", default:dataset_options[0], options:dataset_options, required:true},
      { key:"table_id", label:"テーブル", kind:"text", required:true, default:"defult_table", allowVars:true },
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}", schema_autoload:true, schema_autoload_target:"schema_add_description" },
      { key:"write_disposition", label:"書き込みモード", kind:"combo", required:true, default:"create_or_replace", options:["create_or_replace","create_or_insert"] },
      { key:"schema_add_description", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true, exportKey:"schema" }
    ],

    "CSVConnector.read_csv": [
      { key:"file_path", label:"ファイル", kind:"file", required:true, accept:".csv,.tsv,.txt" },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:csv_encoding_options },
      {
        key:"delimiter",
        label:"区切り文字",
        kind:"combo",
        required:true,
        default:",",
        allowCustom:false,
        options:csv_delimiter_options
      },
      { key:"header_row", label:"ヘッダ行", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"データ開始行", kind:"number", required:true, default:2 },
      { key:"date_field_mode", label:"日付フィールドの取得モード", kind:"combo", required:true, default:"speed", allowCustom:false, options:date_field_mode_options },
      { key:"keep_raw_date_field", label:"オプション", kind:"checkbox", required:false, default:false },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "CSVConnector.write_csv": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"output.csv", allowVars:true, placeholder:"例: result.csv" },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:csv_encoding_options },
      {
        key:"delimiter",
        label:"区切り文字",
        kind:"combo",
        required:true,
        default:",",
        allowCustom:false,
        options:csv_delimiter_options
      },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "ExcelConnector.read_excel": [
      { key:"file_path", label:"ファイル", kind:"file", required:true },
      { key:"sheet_name", label:"シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"header_row", label:"ヘッダ行", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"データ開始行", kind:"number", required:true, default:2 },
      { key:"date_field_mode", label:"日付フィールドの取得モード", kind:"combo", required:true, default:"speed", allowCustom:false, options:date_field_mode_options },
      { key:"keep_raw_date_field", label:"オプション", kind:"checkbox", required:false, default:false },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "ExcelConnector.write_excel": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"output.xlsx", allowVars:true, placeholder:"例: result.xlsx" },
      { key:"sheet_name", label:"シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"mode", label:"書き込みモード", kind:"combo", required:true, default:"create_or_replace", options:["create_or_replace","create_or_insert"] },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "ExcelConnector.read_excel_range": [
      { key:"file_path", label:"ファイル", kind:"file", required:true },
      { key:"sheet_name", label:"シート名", kind:"text", required:true, default:"シート1", allowVars:true },
      { key:"cell_range", label:"読込範囲", kind:"text", required:true, allowVars:true, placeholder:"例: A1:D100" },
      { key:"header_row", label:"ヘッダ行(範囲内)", kind:"number", required:true, default:1 },
      { key:"data_start_row", label:"データ開始行(範囲内)", kind:"number", required:true, default:2 },
      { key:"date_field_mode", label:"日付フィールドの取得モード", kind:"combo", required:true, default:"speed", allowCustom:false, options:date_field_mode_options },
      { key:"keep_raw_date_field", label:"オプション", kind:"checkbox", required:false, default:false },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "PlotlyConnector.plot_combined_bar_line": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"x_col", label:"X列", kind:"text", required:true, allowVars:true },
      { key:"bar_col", label:"棒グラフ列", kind:"text", required:true, allowVars:true },
      { key:"line_col", label:"折れ線列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"棒グラフ＋折れ線グラフ" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"combined_bar_line", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_stacked_bar": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"x_col", label:"X列", kind:"text", required:true, allowVars:true },
      { key:"y_cols", label:"積み上げ列", kind:"text", required:true, allowVars:true, placeholder:"例: cost,profit" },
      { key:"is_percent", label:"100%積み上げ", kind:"combo", required:false, default:"", options:["","1"] },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"積み上げ棒グラフ" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"stacked_bar", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_scorecard": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"value_col", label:"値列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"スコアカード" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"scorecard", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_funnel": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"stage_col", label:"ステージ列", kind:"text", required:true, allowVars:true },
      { key:"value_col", label:"値列", kind:"text", required:true, allowVars:true },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"ファネルチャート" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"funnel", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "PlotlyConnector.plot_radar": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"value_cols", label:"値列（カンマ区切り）", kind:"text", required:true, allowVars:true, placeholder:"例: sales,profit,cost" },
      { key:"name", label:"系列名", kind:"text", required:false, allowVars:true, default:"series" },
      { key:"title", label:"タイトル", kind:"text", required:false, allowVars:true, default:"レーダーチャート" },
      { key:"output_folder", label:"出力フォルダ", kind:"dir", required:true },
      { key:"file_name", label:"出力ファイル名", kind:"text", required:true, default:"radar", allowVars:true },
      { key:"mode", label:"出力形式", kind:"combo", required:true, default:"png", options:["png","html","jpg","jpeg","pdf","svg"] }
    ],

    "OperationConnector.execute_rename": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" }, // optionsは renderer で上流から注入
      { key:"input_data_rename", label:"フィールド名を変更", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}"  }
    ],

    "OperationConnector.define_values": [
      { key:"define_values", label:"パラメータ", kind:"define-values-editor", required:false }
    ],

    "OperationConnector.loop_tasks": [
      { key:"source_step_id", label:"繰り返しデータ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"max_iterations", label:"最大反復数", kind:"number", required:false, default:30, min:1 }
    ],

    "ShellConnector.execute_bat": [
      { key:"file_path", label:"バッチファイル", kind:"file", required:true },
      { key:"args", label:"引数", kind:"text", required:false, allowVars:true }
    ],
    "PythonConnector.execute_python": [
      { key:"env_path", label:"実行環境", kind:"combo", default:pyenv_options[0], options:pyenv_options, required:true},
      { key:"script", label:"スクリプト", kind:"textarea", codeLanguage:"python", required:true, allowVars:true, default:"def main():\n    output = None\n    return output", placeholder:"def main():\n    output = None\n    return output" }
    ],

    "DataintegrationConnector.replace_fields_forrenamelist": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"rename_list_path", label:"RENAMEリストファイル", kind:"file", required:true, default:"config\\rename.csv", accept:".csv" },
      {
        key:"pre_rename_cleansing",
        label:"リネーム前クレンジング",
        kind:"checklist",
        required:false,
        options:[
          { value:"remove_spaces", label:"スペース（全角・半角）を削除" },
          { value:"remove_newlines", label:"改行削除" },
          { value:"to_halfwidth_alnum", label:"全角（数字・英語）を半角変換" },
          { value:"symbols_to_snake", label:"半角記号をスネークケースに変換" }
        ]
      },
      {
        key:"post_rename_cleansing",
        label:"リネーム後クレンジング",
        kind:"checklist",
        required:false,
        options:[
          { value:"exclude_japanese_columns", label:"全角（漢字・ひらがな・カタカナ）文字を含むカラムを対象から外す" }
        ]
      },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "DataintegrationConnector.filter_rows": [
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"conditions", label:"条件指定", kind:"filter-builder", required:false },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "RpaSlackConnector.move_channel": [
      { key:"base_url", label:"Slack URL", kind:"text", required:true, allowVars:true, placeholder:"例: https://app.slack.com/client/..." },
      { key:"channel_name", label:"チャンネル名", kind:"text", required:true, allowVars:true, placeholder:"例: general" },
      { key:"speed", label:"速度倍率", kind:"number", required:false, default:1.0 }
    ],

    "RpaSlackConnector.delete_draft": [
      { key:"speed", label:"速度倍率", kind:"number", required:false, default:1.0 }
    ],

    "RpaSlackConnector.write_draft": [
      { key:"message", label:"メッセージ", kind:"textarea", required:true, allowVars:true, placeholder:"送信するメッセージ" },
      { key:"speed", label:"速度倍率", kind:"number", required:false, default:1.0 }
    ],

    "RpaSlackConnector.get_chrome_info": [
    ],

    "WindowsConnector.rename_and_move_file": [
      { key:"source_file_path", label:"対象ファイル", kind:"file", required:true, allowVars:true },
      { key:"destination_folder", label:"変更後フォルダ", kind:"dir", required:false, allowVars:true },
      { key:"destination_file_name", label:"変更後ファイル名", kind:"text", required:false, allowVars:true, placeholder:"未指定の場合は変更しない" },
      { key:"allow_missing_source", label:"対象ファイルが存在しない場合は成功扱いにする", kind:"checkbox", required:false, default:false }
    ],

    "WindowsConnector.search_files_by_name": [
      { key:"root_folder", label:"ルートフォルダ", kind:"dir", required:true, allowVars:true },
      { key:"recursive", label:"再帰的に子階層のフォルダを検索する", kind:"checkbox", required:false, default:false },
      { key:"file_name_pattern", label:"検索するファイル名（正規表現）", kind:"text", required:false, allowVars:true, placeholder:"例: ^売上_.*" },
      { key:"file_extension_pattern", label:"検索するファイルの拡張子（正規表現）", kind:"text", required:false, allowVars:true, placeholder:"例: csv|xlsx" },
      { key:"max_elapsed_seconds", label:"最大経過時間（秒）", kind:"number", required:true, default:120, min:30, max:480 }
    ],

    "WindowsConnector.search_text_in_files": [
      { key:"root_folder", label:"ルートフォルダ", kind:"dir", required:true, allowVars:true },
      { key:"recursive", label:"再帰的に子階層のフォルダを検索する", kind:"checkbox", required:false, default:false },
      { key:"file_name_pattern", label:"検索するファイル名（正規表現）", kind:"text", required:false, allowVars:true, placeholder:"例: ^売上_.*" },
      { key:"file_extension_pattern", label:"検索するファイルの拡張子（正規表現）", kind:"text", required:false, allowVars:true, placeholder:"例: md|txt" },
      { key:"content_pattern", label:"検索する文字列（正規表現）", kind:"text", required:true, allowVars:true, placeholder:"例: error|warning" },
      { key:"context_lines", label:"取得行（前後行数）", kind:"number", required:true, default:0, min:0, max:200 },
      { key:"max_elapsed_seconds", label:"最大経過時間（秒）", kind:"number", required:true, default:120, min:30, max:480 }
    ],

    "WindowsConnector.create_markdown_file": [
      { key:"write_mode", label:"書き込みモード", kind:"combo", required:true, default:"replace", options:[
        { value:"replace", label:"置換" },
        { value:"append", label:"追記" }
      ]},
      { key:"target_file_path", label:"対象ファイル", kind:"file", required:true, allowVars:true, accept:".md,.markdown,.txt" },
      { key:"content", label:"入力内容", kind:"textarea", required:true, allowVars:true, placeholder:"{{step1.field_name}} で step の1行目を参照できます。" }
    ],

      "WebConnector.open_chrome_page": [
        { key:"url", label:"URL / ファイルパス", kind:"text", required:true, allowVars:true, placeholder:"例: https://example.com または C:/work/index.html" }
      ],
      "WebConnector.lookat_pages": [
        { key:"url", label:"URL", kind:"text", required:true, allowVars:true, placeholder:"例: https://example.com/list" }
      ],
      "WebConnector.lookat_page": [
        { key:"url", label:"URL", kind:"text", required:true, allowVars:true, placeholder:"例: https://example.com/detail" }
      ],
      "WebConnector.easy_get_element": [
        { key:"url", label:"URL（任意）", kind:"text", required:false, allowVars:true, placeholder:"例: https://example.com （未指定時は開いているページを対象）" },
        { key:"text", label:"完全一致文字列", kind:"text", required:true, allowVars:true, placeholder:"例: aaaaa" },
        { key:"occurrence", label:"対象番号（1始まり）", kind:"number", required:true, default:1, min:1 }
      ],
      "WebConnector.easy_click_element": [
        { key:"url", label:"URL（任意）", kind:"text", required:false, allowVars:true, placeholder:"例: https://example.com （未指定時は開いているページを対象）" },
        { key:"text", label:"完全一致文字列", kind:"text", required:true, allowVars:true, placeholder:"例: aaaaa" },
        { key:"occurrence", label:"対象番号（1始まり）", kind:"number", required:true, default:1, min:1 }
      ],
      "APIConnector.run_api": [
        { key:"api_profile", label:"API Profile", kind:"text", required:true, allowVars:true, placeholder:"例: sales_orders_api" },
        { key:"path", label:"相対パス", kind:"text", required:false, allowVars:true, placeholder:"例: /v1/orders" },
        { key:"method", label:"メソッド", kind:"combo", required:true, default:"GET", options:["GET","POST","PUT","PATCH","DELETE"] },
        { key:"headers", label:"ヘッダー(JSON)", kind:"textarea", required:false, placeholder:'例: {\"Accept\":\"application/json\"}' },
        { key:"body", label:"リクエスト本文", kind:"textarea", required:false, allowVars:true, placeholder:"必要な場合のみ入力" }
      ],

      "OutlookConnector.search_mail": [
        { key:"limit", label:"取得件数", kind:"number", required:true, default:10 },
      { key:"sender", label:"送信者", kind:"text", required:false, allowVars:true },
      { key:"subject", label:"件名", kind:"text", required:false, allowVars:true },
      { key:"has_attachments", label:"添付有無", kind:"combo", required:false, default:"true", options:["true","false"] },
      { key:"received", label:"受信日", kind:"combo", required:false, default:"today", options:["today","yesterday"] },
      { key:"allowed_extensions", label:"許可拡張子", kind:"text", required:false, allowVars:true, default:".xlsx,.xls,.csv,.pdf,.txt,.docx,.pptx,.png,.jpg,.jpeg", placeholder:"例: .xlsx,.pdf,.csv" }
    ],

    "OutlookConnector.download_attachments": [
      { key:"limit", label:"取得件数", kind:"number", required:true, default:10 },
      { key:"sender", label:"送信者", kind:"text", required:false, allowVars:true },
      { key:"subject", label:"件名", kind:"text", required:false, allowVars:true },
      { key:"has_attachments", label:"添付有無", kind:"combo", required:false, default:"true", options:["true","false"] },
      { key:"received", label:"受信日", kind:"combo", required:false, default:"today", options:["today","yesterday"] },
      { key:"output_dir", label:"保存先フォルダ", kind:"dir", required:true },
      { key:"allowed_extensions", label:"許可拡張子", kind:"text", required:false, allowVars:true, default:".xlsx,.xls,.csv,.pdf,.txt,.docx,.pptx,.png,.jpg,.jpeg", placeholder:"例: .xlsx,.pdf,.csv" }
    ],

    "OutlookConnector.send_mail": [
      { key:"to", label:"宛先", kind:"text", required:true, allowVars:true, placeholder:"例: user@example.com" },
      { key:"cc", label:"CC", kind:"text", required:false, allowVars:true, placeholder:"例: cc1@example.com;cc2@example.com" },
      { key:"bcc", label:"BCC", kind:"text", required:false, allowVars:true, placeholder:"例: bcc@example.com" },
      { key:"subject", label:"件名", kind:"text", required:true, allowVars:true },
      { key:"body", label:"本文（テキスト）", kind:"textarea", required:false, allowVars:true, placeholder:"テキストメール本文" },
      { key:"html_body", label:"本文（HTML）", kind:"textarea", codeLanguage:"html", required:false, allowVars:true, placeholder:"<html><body><p>HTMLメール本文</p></body></html>" }
    ],


  }
};

window.CONFIG = CONFIG;
const __zizPackagesConfig = window.zizPackages = window.zizPackages || {};
const __zizCoreConfig = __zizPackagesConfig.core = __zizPackagesConfig.core || {};
__zizCoreConfig.CONFIG = CONFIG;

