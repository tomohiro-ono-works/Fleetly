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
const CONFIG = {
  version: 3,

  modes: {
    dataflow: {
      id: "dataflow",
      label: "データフロー",
      defaultFlowName: "データフロー１",
      fileExtension: ".zizd",
      nodeDefaults: {
        initialConnectorId: "WindowsConnector",
        initialActionId: "define_values",
        preferredConnectorId: "BQConnector",
        preferredActionId: "execute_sql",
        loopConnectorId: "WindowsConnector",
        loopActionId: "loop_tasks"
      },
        connectorIds: [
          "BQConnector",
          "DuckConnector",
          "ExcelConnector",
          "CSVConnector",
          "PythonConnector",
          "DataintegrationConnector",
          "VectorConnector",
          "ShellConnector",
          "WindowsConnector",
          "SeleniumConnector",
          "ChromeConnector",
          "PlotlyConnector"
        ]
    }
  },

  connectors: [
    { id: "BQConnector",              label: "BigQuery", exportId: "bigquery_connector"},
    { id: "DuckConnector",            label: "DuckDB", exportId: "duckdb_connector", category: "data", icon: "./img/DuckConnector.jpg"},
    { id: "ExcelConnector",           label: "Excel", exportId: "excel_connector"},
    { id: "CSVConnector",             label: "CSV", exportId: "csv_connector"},
    { id: "PythonConnector",          label: "Python実行", exportId: "python_connector"},
    { id: "ShellConnector",           label: "Shell", exportId: "shell_connector", icon: "./icons/code.svg"},
    { id: "SeleniumConnector",        label: "Selenium", exportId: "selenium_connector", icon: "./img/SeleniumConnector.jpg"},
    { id: "ChromeConnector",          label: "Chrome", exportId: "chrome_connector", icon: "./icons/web.svg"},
    { id: "WindowsConnector",             label: "Windows操作", exportId: "windows_connector"},

    { id: "PlotlyConnector",          label: "Plotly", exportId: "plotly_connector" },
    { id: "DataintegrationConnector", label: "データ加工", exportId: "dataintegration_connector", category: "data", icon: "./icons/brick.svg"},
    { id: "VectorConnector",          label: "VectorDB", exportId: "vector_connector", icon: "./icons/vectordb.svg"},

  ],

  actions: {
    BQConnector: [
      { id: "execute_sql",      label: "SQL実行" , rpaType: "Extract"},
      { id: "execute_sql_file", label: "SQL実行（ファイル）" , rpaType: "Extract"},
      { id: "load_data",        label: "データロード" , rpaType: "Load"}
    ],
    DuckConnector: [
      { id: "create_db_file", label: "DBファイル作成", rpaType: "Load" },
      { id: "execute_sql_file", label: "SQL実行（ファイル）", rpaType: "Extract" },
      { id: "execute_sql", label: "SQL実行", rpaType: "Extract" },
      { id: "create_table", label: "テーブル作成", rpaType: "Load" }
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
    WindowsConnector: [
      { id: "define_values", label: "変数定義" , rpaType: "Transform"},
      { id: "loop_tasks", label: "繰り返し処理" , rpaType: "Transform", nodeType: "loop" },
      { id: "rename_and_move_file", label: "ファイル名変更＆移動", rpaType: "Transform" },
      { id: "search_files_by_name", label: "ファイル名検索", rpaType: "Extract" },
      { id: "search_text_in_files", label: "ファイル内の文字列検索", rpaType: "Extract" },
      { id: "create_markdown_file", label: "マークダウンを作成", rpaType: "Load" },
      { id: "mouse_click", label: "マウスクリック", rpaType: "Transform" },
      { id: "input_text", label: "文字列入力", rpaType: "Transform" },
      { id: "send_keys", label: "キー入力", rpaType: "Transform" },
      { id: "wait", label: "待機", rpaType: "Transform" }
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
    SeleniumConnector: [
      { id: "navigate", label: "ページを開く/遷移", rpaType: "Transform" },
      { id: "dom_action", label: "DOM操作", rpaType: "Transform" },
      { id: "dom_get", label: "DOM取得", rpaType: "Extract" },
      { id: "wait", label: "待機", rpaType: "Transform" },
      { id: "screenshot", label: "スクリーンショット", rpaType: "Load" }
    ],
    ChromeConnector: [
      { id: "open_in_chrome", label: "Chrome でページを開く", rpaType: "Transform" }
    ],
    PythonConnector: [
      { id: "execute_python", label: "Python実行" , rpaType: "Transform"}
    ]
  },

  forms: {
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

    "DuckConnector.create_db_file": [
      { key:"db_folder", label:"DBファイルの場所", kind:"dir", required:true },
      { key:"db_file_name", label:"DBファイル名", kind:"text", required:true, default:"sample.duckdb", allowVars:true },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "DuckConnector.execute_sql_file": [
      { key:"db_file", label:"DBファイル", kind:"file", required:true, accept:".duckdb,.db,.ddb" },
      { key:"sql_file", label:"SQLファイル", kind:"file", required:true, accept:".sql" },
      { key:"encoding", label:"文字コード", kind:"combo", required:true, default:"utf8", options:["utf8","shift_jis","cp932"] },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "DuckConnector.execute_sql": [
      { key:"db_file", label:"DBファイル", kind:"file", required:true, accept:".duckdb,.db,.ddb" },
      { key:"sql", label:"SQL", kind:"textarea", codeLanguage:"sql", required:true, allowVars:true, placeholder:"SELECT ...\nFROM ..." },
      { key:"schema", label:"スキーマ定義", kind:"textarea", required:false, allowVars:true }
    ],

    "DuckConnector.create_table": [
      { key:"db_file", label:"DBファイル", kind:"file", required:true, accept:".duckdb,.db,.ddb" },
      { key:"input_data", label:"step", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"table_name", label:"テーブル名", kind:"text", required:true, allowVars:true, default:"table1" }
    ],

    "VectorConnector.embedding_vector_db": [
      { key:"db_folder", label:"ベクトルDB保存先", kind:"dir", required:true },
      { key:"collection_name", label:"コレクション名", kind:"text", required:true, default:"default", allowVars:true },
      { key:"input_data", label:"入力データ", kind:"text", required:true, allowVars:true, placeholder:"例: {{step1}}" },
      { key:"id_column", label:"ID列名", kind:"text", required:true, default:"id", allowVars:true },
      { key:"text_column", label:"テキスト列名", kind:"text", required:true, default:"text", allowVars:true },
      { key:"model_name", label:"埋め込みモデル", kind:"text", required:false, default:"cl-nagoya/ruri-v3-30m", allowVars:true }
    ],

    "VectorConnector.search_vector_db": [
      { key:"db_folder", label:"ベクトルDB保存先", kind:"dir", required:true },
      { key:"collection_name", label:"コレクション名", kind:"text", required:true, default:"default", allowVars:true },
      { key:"query_text", label:"検索テキスト", kind:"textarea", required:true, allowVars:true },
      { key:"top_k", label:"取得件数", kind:"number", required:true, default:5, allowVars:true },
      { key:"include_vector", label:"ベクトルを含める", kind:"combo", required:true, default:"false", options:["false","true"] },
      { key:"model_name", label:"埋め込みモデル", kind:"text", required:false, default:"cl-nagoya/ruri-v3-30m", allowVars:true }
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
      { key:"chunk_size", label:"分割行数", kind:"number", required:false, default:50000 },
      { key:"date_cleansing", label:"日付クレンジング", kind:"checkbox", required:false, default:true },
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
      { key:"chunk_size", label:"分割行数", kind:"number", required:false, default:50000 },
      { key:"date_cleansing", label:"日付クレンジング", kind:"checkbox", required:false, default:true },
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
      { key:"date_cleansing", label:"日付クレンジング", kind:"checkbox", required:false, default:true },
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

    "WindowsConnector.define_values": [
      { key:"define_values", label:"パラメータ", kind:"define-values-editor", required:false }
    ],

    "WindowsConnector.loop_tasks": [
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
      { key:"content", label:"入力内容", kind:"textarea", codeLanguage:"markdown", required:true, allowVars:true, placeholder:"{{step1.field_name}} で step の1行目を参照できます。" }
    ],

    "WindowsConnector.mouse_click": [
      { key:"coordinate_mode", label:"座標指定", kind:"combo", required:true, default:"specified", allowCustom:false, options:[
        { value:"current", label:"現在座標" },
        { value:"specified", label:"座標を指定する" }
      ]},
      { key:"x", label:"X 座標", kind:"number", required:true, allowVars:true, placeholder:"例: 640", visible_if:{ key:"coordinate_mode", in:["specified", ""] } },
      { key:"y", label:"Y 座標", kind:"number", required:true, allowVars:true, placeholder:"例: 480", visible_if:{ key:"coordinate_mode", in:["specified", ""] } },
      { key:"coordinate_picker", label:"マウスで指定する", kind:"mouse-coordinate-picker", x_key:"x", y_key:"y", visible_if:{ key:"coordinate_mode", in:["specified", ""] } },
      { key:"button", label:"ボタン", kind:"combo", required:true, default:"left", allowCustom:false, options:[
        { value:"left", label:"左クリック" },
        { value:"right", label:"右クリック" }
      ]},
      { key:"click_count", label:"クリック回数", kind:"combo", required:true, default:"1", allowCustom:false, options:[
        { value:"1", label:"1 回" },
        { value:"2", label:"2 回（ダブルクリック）" }
      ]}
    ],

    "WindowsConnector.input_text": [
      { key:"input_mode", label:"入力モード", kind:"combo", required:true, default:"replace", allowCustom:false, options:[
        { value:"replace", label:"置換（全選択して入力）" },
        { value:"append", label:"追記" }
      ]},
      { key:"text", label:"入力文字列", kind:"textarea", required:true, allowVars:true }
    ],

    "WindowsConnector.send_keys": [
      { key:"modifier_keys", label:"修飾キー", kind:"checklist", required:false, options:[
        { value:"ctrl", label:"Ctrl" },
        { value:"shift", label:"Shift" },
        { value:"alt", label:"Alt" }
      ]},
      { key:"key", label:"キー", kind:"text", required:true, allowVars:true, placeholder:"例: A, 1, ENTER, F5" },
      { key:"wait_seconds", label:"送信後待機 (秒)", kind:"number", required:false, default:0, min:0, allowVars:true }
    ],

    "WindowsConnector.wait": [
      { key:"duration_seconds", label:"待機時間 (秒)", kind:"number", required:true, default:1, min:0, max:600, allowVars:true }
    ],

      "SeleniumConnector.navigate": [
        { key:"url", label:"URL", kind:"text", required:true, allowVars:true, placeholder:"例: https://example.com" },
        { key:"tab_mode", label:"タブモード", kind:"combo", required:true, default:"reuse_or_new", options:["current","new","reuse","reuse_or_new"] },
        { key:"headless", label:"ヘッドレス実行", kind:"checkbox", required:false, default:false },
        { key:"wait_until", label:"遷移待機", kind:"combo", required:true, default:"none", options:["none","load","domcontentloaded","networkidle"] },
        { key:"timeout_ms", label:"タイムアウト(ms)", kind:"number", required:false, default:10000, min:1000 }
      ],
      "SeleniumConnector.dom_action": [
        { key:"source_step_id", label:"参照ステップ", kind:"text", required:false, allowVars:true, placeholder:"例: step6" },
        { key:"operation", label:"操作種別", kind:"combo", required:true, default:"click", options:["click","input","select","check","uncheck","key","scroll"] },
        { key:"selector_type", label:"セレクタ種別", kind:"combo", required:false, default:"css", options:["css","xpath","text"], visible_if:{ key:"operation", in:["click","input","select","check","uncheck","scroll"] } },
        { key:"selector", label:"セレクタ", kind:"text", required:true, allowVars:true, placeholder:"例: #message", visible_if:{ key:"operation", in:["click","input","select","check","uncheck","scroll"] } },
        { key:"value", label:"値", kind:"text", required:true, allowVars:true, placeholder:"例: 送信予定メッセージ", visible_if:{ key:"operation", in:["input","select"] } },
        { key:"value_ref", label:"値の参照変数", kind:"text", required:false, allowVars:true, placeholder:"例: table_name", visible_if:{ key:"operation", equals:"input" } },
        { key:"clear", label:"入力前クリア", kind:"checkbox", required:false, default:true, visible_if:{ key:"operation", equals:"input" } },
        { key:"label", label:"選択ラベル", kind:"text", required:false, allowVars:true, visible_if:{ key:"operation", equals:"select" } },
        { key:"index", label:"選択インデックス", kind:"number", required:false, min:0, visible_if:{ key:"operation", equals:"select" } },
        { key:"key", label:"キー入力", kind:"text", required:true, allowVars:true, placeholder:"例: Enter", visible_if:{ key:"operation", equals:"key" } },
        { key:"to", label:"スクロール先", kind:"combo", required:false, default:"", options:["","top","bottom","element"], visible_if:{ key:"operation", equals:"scroll" } },
        { key:"direction", label:"スクロール方向", kind:"combo", required:false, default:"down", options:["up","down","left","right"], visible_if:{ key:"operation", equals:"scroll" } },
        { key:"amount", label:"スクロール量", kind:"number", required:false, default:800, min:1, visible_if:{ key:"operation", equals:"scroll" } },
        { key:"timeout_ms", label:"タイムアウト(ms)", kind:"number", required:false, default:10000, min:1000 }
      ],
      "SeleniumConnector.dom_get": [
        { key:"source_step_id", label:"参照ステップ", kind:"text", required:false, allowVars:true, placeholder:"例: step6" },
        { key:"get_type", label:"取得種別", kind:"combo", required:true, default:"text", options:["html","text","value","attribute","count"] },
        { key:"selector_type", label:"セレクタ種別", kind:"combo", required:false, default:"css", options:["css","xpath","text"] },
        { key:"selector", label:"セレクタ", kind:"text", required:true, allowVars:true, placeholder:"例: .title" },
        { key:"attribute", label:"属性名", kind:"text", required:true, allowVars:true, placeholder:"例: href", visible_if:{ key:"get_type", equals:"attribute" } },
        { key:"all", label:"複数要素を取得", kind:"checkbox", required:false, default:false },
        { key:"outer", label:"outerHTML取得", kind:"checkbox", required:false, default:false, visible_if:{ key:"get_type", equals:"html" } }
      ],
      "SeleniumConnector.wait": [
        { key:"source_step_id", label:"参照ステップ", kind:"text", required:false, allowVars:true, placeholder:"例: step6" },
        { key:"until", label:"待機条件", kind:"combo", required:true, default:"selector_visible", options:["selector_visible","selector_hidden","selector_attached","selector_detached","url_contains","url_equals","url_regex","load","sleep"] },
        { key:"selector_type", label:"セレクタ種別", kind:"combo", required:false, default:"css", options:["css","xpath","text"], visible_if:{ key:"until", in:["selector_visible","selector_hidden","selector_attached","selector_detached"] } },
        { key:"selector", label:"セレクタ", kind:"text", required:true, allowVars:true, visible_if:{ key:"until", in:["selector_visible","selector_hidden","selector_attached","selector_detached"] } },
        { key:"value", label:"URL条件", kind:"text", required:true, allowVars:true, visible_if:{ key:"until", in:["url_contains","url_equals","url_regex"] } },
        { key:"state", label:"読み込み状態", kind:"combo", required:false, default:"domcontentloaded", options:["load","domcontentloaded","networkidle"], visible_if:{ key:"until", equals:"load" } },
        { key:"ms", label:"待機時間(ms)", kind:"number", required:true, default:1000, min:1, visible_if:{ key:"until", equals:"sleep" } },
        { key:"timeout_ms", label:"タイムアウト(ms)", kind:"number", required:false, default:10000, min:1000 }
      ],
      "SeleniumConnector.screenshot": [
        { key:"source_step_id", label:"参照ステップ", kind:"text", required:false, allowVars:true, placeholder:"例: step6" },
        { key:"path", label:"保存先パス", kind:"text", required:true, allowVars:true, default:"./workflows/web_screenshot.png", placeholder:"例: ./workflows/web_screenshot.png" },
        { key:"target", label:"対象", kind:"combo", required:true, default:"page", options:["page","element"] },
        { key:"selector_type", label:"セレクタ種別", kind:"combo", required:false, default:"css", options:["css","xpath","text"], visible_if:{ key:"target", equals:"element" } },
        { key:"selector", label:"セレクタ", kind:"text", required:true, allowVars:true, visible_if:{ key:"target", equals:"element" } },
        { key:"full_page", label:"ページ全体を撮影", kind:"checkbox", required:false, default:true, visible_if:{ key:"target", equals:"page" } }
      ],
      "ChromeConnector.open_in_chrome": [
        { key:"url", label:"URL", kind:"text", required:true, allowVars:true, placeholder:"例: https://example.com" }
      ],
  }
};

window.CONFIG = CONFIG;
const __zizPackagesConfig = window.zizPackages = window.zizPackages || {};
const __zizCoreConfig = __zizPackagesConfig.core = __zizPackagesConfig.core || {};
__zizCoreConfig.CONFIG = CONFIG;
