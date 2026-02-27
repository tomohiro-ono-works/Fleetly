import os
from typing import Any, Iterable, Optional

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from connectors.base_connector import BaseConnector


SUPPORTED_OUTPUT_MODES = {"png", "html", "jpg", "jpeg", "pdf", "svg"}


def _save_figure(fig: go.Figure, folder: str, file_name: str, mode: str) -> str:
    """グラフを保存し、保存先ファイルパスを返す。"""
    normalized_mode = str(mode or "png").lower()
    if normalized_mode not in SUPPORTED_OUTPUT_MODES:
        raise ValueError(f"未対応の出力形式です: {mode}")

    if not folder:
        raise ValueError("保存先フォルダが指定されていません。")
    if not file_name:
        raise ValueError("ファイル名が指定されていません。")

    os.makedirs(folder, exist_ok=True)
    file_path = os.path.join(folder, f"{file_name}.{normalized_mode}")

    if normalized_mode == "html":
        fig.write_html(file_path)
    else:
        fig.write_image(file_path)

    return file_path


def _to_dataframe(json_data: Any) -> pd.DataFrame:
    """行指向JSON（list[dict]）をDataFrameに変換する。"""
    if not isinstance(json_data, list):
        raise ValueError("json_data は list[dict] 形式で指定してください。")
    return pd.DataFrame(json_data)


def _ensure_list(value: Any, *, field_name: str) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, tuple):
        return [str(v) for v in value]
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    raise ValueError(f"{field_name} は list またはカンマ区切り文字列で指定してください。")


def _aggregate_by_axis_sum(df: pd.DataFrame, axis_col: str, value_cols: Iterable[str]) -> pd.DataFrame:
    """軸列で集計し、値列は合計する（軸の出現順を維持）。"""
    if axis_col not in df.columns:
        raise ValueError(f"軸列が見つかりません: {axis_col}")

    target_value_cols = [str(col) for col in value_cols]
    missing = [col for col in target_value_cols if col not in df.columns]
    if missing:
        raise ValueError(f"値列が見つかりません: {', '.join(missing)}")

    work = df.copy()
    for col in target_value_cols:
        work[col] = pd.to_numeric(work[col], errors="coerce").fillna(0)

    return work.groupby(axis_col, as_index=False, sort=False)[target_value_cols].sum()


def _aggregate_columns_sum(df: pd.DataFrame, value_cols: Iterable[str]) -> tuple[list[str], list[float]]:
    """横持ちデータの値列を列ごとに合計し、レーダーチャート用の軸と値へ変換する。"""
    target_value_cols = [str(col) for col in value_cols]
    if not target_value_cols:
        raise ValueError("value_cols は1件以上指定してください。")

    missing = [col for col in target_value_cols if col not in df.columns]
    if missing:
        raise ValueError(f"値列が見つかりません: {', '.join(missing)}")

    work = df.copy()
    for col in target_value_cols:
        work[col] = pd.to_numeric(work[col], errors="coerce").fillna(0)

    summed = work[target_value_cols].sum(axis=0)
    return target_value_cols, [float(summed[col]) for col in target_value_cols]


def _plot_combined_bar_line(
    json_data: Any,
    x_col: str,
    bar_col: str,
    line_col: str,
    title: str,
    folder: str,
    file_name: str,
    mode: str = "png",
) -> str:
    df = _aggregate_by_axis_sum(_to_dataframe(json_data), x_col, [bar_col, line_col])
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    fig.add_trace(go.Bar(x=df[x_col], y=df[bar_col], name=bar_col), secondary_y=False)
    fig.add_trace(
        go.Scatter(x=df[x_col], y=df[line_col], name=line_col, mode="lines+markers"),
        secondary_y=True,
    )
    fig.update_layout(title=title, hovermode="x unified")
    return _save_figure(fig, folder, file_name, mode)


def _plot_stacked_bar(
    json_data: Any,
    x_col: str,
    y_cols: Iterable[str],
    title: str,
    folder: str,
    file_name: str,
    is_percent: bool = False,
    mode: str = "png",
) -> str:
    df = _aggregate_by_axis_sum(_to_dataframe(json_data), x_col, y_cols)
    fig = go.Figure()

    barnorm = "percent" if is_percent else None
    for col in y_cols:
        fig.add_trace(go.Bar(x=df[x_col], y=df[col], name=col))

    fig.update_layout(title=title, barmode="stack", barnorm=barnorm)
    return _save_figure(fig, folder, file_name, mode)


def _plot_scorecard(
    json_data: Any,
    value_col: str,
    title: str,
    folder: str,
    file_name: str,
    mode: str = "png",
) -> str:
    df = _to_dataframe(json_data)
    if df.empty:
        raise ValueError("scorecard 用のデータが空です。")

    current_val = df[value_col].iloc[-1]
    reference_val = df[value_col].iloc[-2] if len(df) > 1 else current_val

    fig = go.Figure(
        go.Indicator(
            mode="number+delta",
            value=current_val,
            delta={"reference": reference_val, "relative": True, "valueformat": ".1%"},
            title={"text": title},
        )
    )
    return _save_figure(fig, folder, file_name, mode)


def _plot_funnel(
    json_data: Any,
    stage_col: str,
    value_col: str,
    title: str,
    folder: str,
    file_name: str,
    mode: str = "png",
) -> str:
    df = _aggregate_by_axis_sum(_to_dataframe(json_data), stage_col, [value_col])
    fig = go.Figure(
        go.Funnel(
            y=df[stage_col],
            x=df[value_col],
            textinfo="value+percent initial",
        )
    )
    fig.update_layout(title=title)
    return _save_figure(fig, folder, file_name, mode)


def _plot_radar(
    json_data: Any,
    theta_col: str,
    r_col: str,
    name: str,
    title: str,
    folder: str,
    file_name: str,
    mode: str = "png",
    value_cols: Optional[Iterable[str]] = None,
) -> str:
    raw_df = _to_dataframe(json_data)
    if raw_df.empty:
        raise ValueError("radar 用のデータが空です。")

    if value_cols:
        theta_values, r_values = _aggregate_columns_sum(raw_df, value_cols)
    else:
        df = _aggregate_by_axis_sum(raw_df, theta_col, [r_col])
        theta_values = df[theta_col].tolist()
        r_values = df[r_col].tolist()

    r_values.append(r_values[0])
    theta_values.append(theta_values[0])

    fig = go.Figure(
        data=go.Scatterpolar(r=r_values, theta=theta_values, fill="toself", name=name)
    )
    fig.update_layout(
        title=title,
        polar=dict(radialaxis=dict(visible=True, range=[0, max(r_values) * 1.1])),
    )
    return _save_figure(fig, folder, file_name, mode)


# 既存の直接呼び出しコード互換のため、トップレベル関数も残す
def plot_combined_bar_line(json_data, x_col, bar_col, line_col, title, folder, file_name, mode="png"):
    return _plot_combined_bar_line(json_data, x_col, bar_col, line_col, title, folder, file_name, mode)


def plot_stacked_bar(json_data, x_col, y_cols, title, folder, file_name, is_percent=False, mode="png"):
    return _plot_stacked_bar(json_data, x_col, y_cols, title, folder, file_name, is_percent, mode)


def plot_scorecard(json_data, value_col, title, folder, file_name, mode="png"):
    return _plot_scorecard(json_data, value_col, title, folder, file_name, mode)


def plot_funnel(json_data, stage_col, value_col, title, folder, file_name, mode="png"):
    return _plot_funnel(json_data, stage_col, value_col, title, folder, file_name, mode)


def plot_radar(json_data, theta_col, r_col, name, title, folder, file_name, mode="png"):
    return _plot_radar(json_data, theta_col, r_col, name, title, folder, file_name, mode)


class PlotlyConnector(BaseConnector):
    def execute(self, action: str, params: dict, context: dict) -> Any:
        if action == "plot_combined_bar_line":
            return self.plot_combined_bar_line(params, context)
        if action == "plot_stacked_bar":
            return self.plot_stacked_bar(params, context)
        if action == "plot_scorecard":
            return self.plot_scorecard(params, context)
        if action == "plot_funnel":
            return self.plot_funnel(params, context)
        if action == "plot_radar":
            return self.plot_radar(params, context)
        raise ValueError(f"Unknown action: {action}")

    def _get_input_data(self, params: dict, context: dict) -> Any:
        input_var = params.get("input_data")
        if input_var:
            data = context.get(input_var)
            if data is None:
                raise ValueError(f"変数 '{input_var}' にデータがありません。")
            return data

        json_data = params.get("json_data")
        if json_data is None:
            raise ValueError("input_data または json_data のいずれかを指定してください。")
        return json_data

    def _get_output_options(self, params: dict, *, default_file_name: str) -> tuple[str, str, str]:
        folder = self.normalize_file_path(params.get("output_folder")) or self.normalize_file_path(
            params.get("folder")
        )
        file_name = str(params.get("file_name") or default_file_name)
        mode = str(params.get("mode", "png"))

        if not folder:
            raise ValueError("output_folder（または folder）が指定されていません。")
        if not file_name:
            raise ValueError("file_name が指定されていません。")
        return folder, file_name, mode

    def plot_combined_bar_line(self, params: dict, context: dict) -> str:
        data = self._get_input_data(params, context)
        folder, file_name, mode = self._get_output_options(params, default_file_name="combined_bar_line")
        return _plot_combined_bar_line(
            json_data=data,
            x_col=str(params.get("x_col")),
            bar_col=str(params.get("bar_col")),
            line_col=str(params.get("line_col")),
            title=str(params.get("title", "棒グラフ＋折れ線グラフ")),
            folder=folder,
            file_name=file_name,
            mode=mode,
        )

    def plot_stacked_bar(self, params: dict, context: dict) -> str:
        data = self._get_input_data(params, context)
        folder, file_name, mode = self._get_output_options(params, default_file_name="stacked_bar")
        y_cols = _ensure_list(params.get("y_cols"), field_name="y_cols")
        return _plot_stacked_bar(
            json_data=data,
            x_col=str(params.get("x_col")),
            y_cols=y_cols,
            title=str(params.get("title", "積み上げ棒グラフ")),
            folder=folder,
            file_name=file_name,
            is_percent=bool(params.get("is_percent", False)),
            mode=mode,
        )

    def plot_scorecard(self, params: dict, context: dict) -> str:
        data = self._get_input_data(params, context)
        folder, file_name, mode = self._get_output_options(params, default_file_name="scorecard")
        return _plot_scorecard(
            json_data=data,
            value_col=str(params.get("value_col")),
            title=str(params.get("title", "スコアカード")),
            folder=folder,
            file_name=file_name,
            mode=mode,
        )

    def plot_funnel(self, params: dict, context: dict) -> str:
        data = self._get_input_data(params, context)
        folder, file_name, mode = self._get_output_options(params, default_file_name="funnel")
        return _plot_funnel(
            json_data=data,
            stage_col=str(params.get("stage_col")),
            value_col=str(params.get("value_col")),
            title=str(params.get("title", "ファネルチャート")),
            folder=folder,
            file_name=file_name,
            mode=mode,
        )

    def plot_radar(self, params: dict, context: dict) -> str:
        data = self._get_input_data(params, context)
        folder, file_name, mode = self._get_output_options(params, default_file_name="radar")
        value_cols_param = params.get("value_cols")
        value_cols = _ensure_list(value_cols_param, field_name="value_cols") if value_cols_param else None
        return _plot_radar(
            json_data=data,
            theta_col=str(params.get("theta_col", "")),
            r_col=str(params.get("r_col", "")),
            name=str(params.get("name", "series")),
            title=str(params.get("title", "レーダーチャート")),
            folder=folder,
            file_name=file_name,
            mode=mode,
            value_cols=value_cols,
        )
