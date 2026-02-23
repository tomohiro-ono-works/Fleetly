import os
import sys
import threading
import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

# 自作モジュールのインポート
from core.workflow_engine import WorkflowEngine
from core.logger import setup_logger, log_queue

# アプリケーション初期化
app = FastAPI(title="mokuromi API")
logger = setup_logger()
engine = WorkflowEngine(logger)

# ディレクトリの準備
WORKFLOW_DIR = "workflows"
if not os.path.exists(WORKFLOW_DIR):
    os.makedirs(WORKFLOW_DIR)

# CORS設定（開発用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 静的ファイルの提供 ---
# /static フォルダをマウント
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def index():
    """ルートアクセスでGUIを表示"""
    return FileResponse("static/index.html")


# --- ワークフロー管理API ---

@app.get("/api/workflows")
async def list_workflows():
    """workflowsフォルダ内のYAMLファイル一覧を取得"""
    try:
        files = [f for f in os.listdir(WORKFLOW_DIR) if f.endswith(".yaml")]
        return {"workflows": sorted(files)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/workflows/{filename}")
async def get_workflow(filename: str):
    """ファイルの内容を読み込む"""
    path = os.path.join(WORKFLOW_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="ファイルが見つかりません")
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/workflows/{filename}")
async def save_workflow(filename: str, payload: dict = Body(...)):
    """ファイルの内容を保存する（バリデーション付き）"""
    content = payload.get("content", "")
    path = os.path.join(WORKFLOW_DIR, filename)

    # YAML構文チェック
    try:
        yaml.safe_load(content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"YAML構文エラー: {str(e)}")

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"status": "success", "message": f"{filename} を保存しました"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/workflows/new/{filename}")
async def create_workflow(filename: str):
    """新規ワークフローファイルを作成"""
    if not filename.endswith(".yaml"):
        filename += ".yaml"
    
    path = os.path.join(WORKFLOW_DIR, filename)
    if os.path.exists(path):
        raise HTTPException(status_code=400, detail="同名のファイルが既に存在します")

    initial_yaml = """workflow_metadata:
  name: "新規ワークフロー"
steps:
  - step_id: "step_01"
    connector: "file_connector"
    action: "read_csv"
    params:
      file_path: "C:/data/input.csv"
    output_variable: "temp_data"
"""
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(initial_yaml)
        return {"status": "success", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- ワークフロー実行API ---

@app.post("/api/execute/{filename}")
async def execute_workflow(filename: str):
    """指定されたワークフローを別スレッドで実行開始"""
    path = os.path.join(WORKFLOW_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="ファイルが見つかりません")

    # Webサーバーのレスポンスを止めないよう、実行はスレッドで逃がす
    def run():
        try:
            engine.run_workflow(path)
        except Exception as e:
            logger.error(f"実行中に予期せぬエラーが発生しました: {e}")

    thread = threading.Thread(target=run)
    thread.start()
    
    return {"status": "started", "workflow": filename}


# --- リアルタイムログ配信 (WebSocket) ---

@app.websocket("/ws/logs")
async def websocket_endpoint(websocket: WebSocket):
    """エンジンからのログをフロントエンドに垂れ流す"""
    await websocket.accept()
    try:
        while True:
            # log_queue に新しいログが入るまで非同期待機
            message = await log_queue.get()
            await websocket.send_text(message)
    except WebSocketDisconnect:
        # クライアントがブラウザを閉じた場合
        pass
    except Exception as e:
        print(f"WebSocket Error: {e}")

# --- エントリーポイントの制御 ---

def run_gui():
    """GUI（Webサーバー）モードで起動"""
    import uvicorn
    logger.info("GUIモードで起動します: http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)

def run_cli(yaml_path):
    """CLIモードでワークフローを実行"""
    if not os.path.exists(yaml_path):
        logger.error(f"ファイルが見つかりません: {yaml_path}")
        return

    logger.info(f"CLIモードで実行開始: {yaml_path}")
    try:
        engine.run_workflow(yaml_path)
        logger.info("CLI実行が正常に完了しました。")
    except Exception as e:
        logger.error(f"CLI実行中にエラーが発生しました: {e}")

if __name__ == "__main__":
    # 引数がある場合はCLIモード、ない場合はGUIモード
    if len(sys.argv) > 1:
        # 例: python main.py workflows/sample.yaml
        run_cli(sys.argv[1])
    else:
        # 例: python main.py
        run_gui()