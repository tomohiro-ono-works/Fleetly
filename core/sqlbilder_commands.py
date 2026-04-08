import re

from sqlglot import exp, parse_one


CLAUSE_KEYWORDS = (
    "WITH",
    "SELECT",
    "FROM",
    "WHERE",
    "LEFT JOIN",
    "INNER JOIN",
    "RIGHT JOIN",
    "FULL JOIN",
    "CROSS JOIN",
    "JOIN",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "QUALIFY",
    "LIMIT",
    "UNION",
)

SELECT_END_KEYWORDS = tuple(keyword for keyword in CLAUSE_KEYWORDS if keyword not in {"WITH", "SELECT"})


def _iter_sql_chars(text: str):
    in_single = False
    in_double = False
    in_backtick = False
    in_line_comment = False
    depth = 0
    index = 0
    while index < len(text):
        ch = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if in_line_comment:
            yield index, ch, depth, in_line_comment
            if ch == "\n":
                in_line_comment = False
            index += 1
            continue
        if not in_double and not in_backtick and ch == "'" and text[index - 1:index] != "\\":
            in_single = not in_single
        elif not in_single and not in_backtick and ch == '"' and text[index - 1:index] != "\\":
            in_double = not in_double
        elif not in_single and not in_double and ch == "`":
            in_backtick = not in_backtick
        elif not in_single and not in_double and not in_backtick:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                yield index, ch, depth, in_line_comment
                index += 1
                yield index, nxt, depth, in_line_comment
                index += 1
                continue
            if ch == "(":
                depth += 1
            elif ch == ")" and depth > 0:
                depth -= 1
        yield index, ch, depth, in_line_comment
        index += 1


def _find_top_level_keyword(text: str, keyword: str, start: int = 0):
    target = keyword.upper()
    for index, _, depth, in_line_comment in _iter_sql_chars(text[start:]):
        absolute = start + index
        if in_line_comment or depth != 0:
            continue
        if text[absolute:absolute + len(target)].upper() != target:
            continue
        before = text[absolute - 1] if absolute > 0 else " "
        after = text[absolute + len(target)] if absolute + len(target) < len(text) else " "
        if (before.isalnum() or before == "_") or (after.isalnum() or after == "_"):
            continue
        return absolute
    return -1


def _line_number_at(text: str, offset: int):
    if offset <= 0:
        return 0
    return text[:offset].count("\n")


def _find_keyword_occurrences(text: str, keywords, start: int = 0):
    occurrences = []
    sorted_keywords = sorted(set(keywords), key=len, reverse=True)
    for index, _, depth, in_line_comment in _iter_sql_chars(text[start:]):
        absolute = start + index
        if in_line_comment:
            continue
        for keyword in sorted_keywords:
            keyword_length = len(keyword)
            if text[absolute:absolute + keyword_length].upper() != keyword:
                continue
            before = text[absolute - 1] if absolute > 0 else " "
            after = text[absolute + keyword_length] if absolute + keyword_length < len(text) else " "
            if (before.isalnum() or before == "_") or (after.isalnum() or after == "_"):
                continue
            occurrences.append({
                "keyword": keyword,
                "offset": absolute,
                "depth": depth,
                "line": _line_number_at(text, absolute),
            })
            break
    return occurrences


def _find_select_list_range(sql_text: str):
    text = str(sql_text or "")
    select_index = _find_top_level_keyword(text, "SELECT")
    if select_index < 0:
        raise ValueError("SELECT 句が見つかりません。")
    select_body_start = select_index + len("SELECT")
    clause_positions = [
        _find_top_level_keyword(text, keyword, start=select_body_start)
        for keyword in CLAUSE_KEYWORDS
    ]
    clause_positions = [position for position in clause_positions if position >= 0]
    select_body_end = min(clause_positions) if clause_positions else len(text)
    return select_body_start, select_body_end


def _find_select_list_ranges(sql_text: str):
    text = str(sql_text or "")
    occurrences = _find_keyword_occurrences(text, CLAUSE_KEYWORDS)
    select_occurrences = [occurrence for occurrence in occurrences if occurrence["keyword"] == "SELECT"]
    ranges = []
    for select_occurrence in select_occurrences:
        select_body_start = select_occurrence["offset"] + len("SELECT")
        candidates = [
            occurrence["offset"]
            for occurrence in occurrences
            if occurrence["offset"] >= select_body_start
            and occurrence["depth"] == select_occurrence["depth"]
            and occurrence["keyword"] in SELECT_END_KEYWORDS
        ]
        select_body_end = min(candidates) if candidates else len(text)
        ranges.append({
            "start": select_body_start,
            "end": select_body_end,
            "depth": select_occurrence["depth"],
            "start_line": _line_number_at(text, select_body_start),
            "end_line": _line_number_at(text, max(select_body_end - 1, 0)),
        })
    return ranges


def _find_select_list_range_for_lines(sql_text: str, selection_start_line: int, selection_end_line: int):
    start_line = min(int(selection_start_line), int(selection_end_line))
    end_line = max(int(selection_start_line), int(selection_end_line))
    ranges = _find_select_list_ranges(sql_text)
    overlapping = [
        item for item in ranges
        if not (item["end_line"] < start_line or item["start_line"] > end_line)
    ]
    if overlapping:
        overlapping.sort(key=lambda item: (item["depth"], -(item["end"] - item["start"])), reverse=True)
        selected = overlapping[0]
        return selected["start"], selected["end"]
    containing = [
        item for item in ranges
        if item["start_line"] <= start_line <= item["end_line"]
    ]
    if containing:
        containing.sort(key=lambda item: (item["depth"], -(item["end"] - item["start"])), reverse=True)
        selected = containing[0]
        return selected["start"], selected["end"]
    return _find_select_list_range(sql_text)


def _offset_to_line(offsets, target):
    for index in range(len(offsets) - 1):
        if offsets[index] <= target < offsets[index + 1]:
            return index
    return max(0, len(offsets) - 2)


def _line_offsets(lines):
    offsets = []
    total = 0
    for line in lines:
        offsets.append(total)
        total += len(line) + 1
    offsets.append(total)
    return offsets


def _find_comment_start(line: str):
    in_single = False
    in_double = False
    in_backtick = False
    for index in range(len(line) - 1):
        ch = line[index]
        nxt = line[index + 1]
        if not in_double and not in_backtick and ch == "'" and line[index - 1:index] != "\\":
            in_single = not in_single
            continue
        if not in_single and not in_backtick and ch == '"' and line[index - 1:index] != "\\":
            in_double = not in_double
            continue
        if not in_single and not in_double and ch == "`":
            in_backtick = not in_backtick
            continue
        if not in_single and not in_double and not in_backtick and ch == "-" and nxt == "-":
            return index
    return -1


def _strip_inline_comment(line: str):
    comment_start = _find_comment_start(line)
    if comment_start < 0:
        return line, ""
    return line[:comment_start], line[comment_start:]


def _line_depth_delta(line: str):
    code, _ = _strip_inline_comment(line)
    in_single = False
    in_double = False
    in_backtick = False
    delta = 0
    for ch in code:
        if not in_double and not in_backtick and ch == "'" and ch != "\\":
            in_single = not in_single
            continue
        if not in_single and not in_backtick and ch == '"' and ch != "\\":
            in_double = not in_double
            continue
        if not in_single and not in_double and ch == "`":
            in_backtick = not in_backtick
            continue
        if in_single or in_double or in_backtick:
            continue
        if ch == "(":
            delta += 1
        elif ch == ")":
            delta -= 1
    return delta


def _group_select_items(sql_text: str, *, selection_start_line: int = 0, selection_end_line: int = 0):
    lines = str(sql_text or "").splitlines()
    if not lines:
        return []
    offsets = _line_offsets(lines)
    select_start, select_end = _find_select_list_range_for_lines(sql_text, selection_start_line, selection_end_line)
    start_line = _offset_to_line(offsets, select_start)
    end_line = _offset_to_line(offsets, max(select_end - 1, 0))
    items = []
    current = None
    depth = 0

    for line_index in range(start_line, min(end_line + 1, len(lines))):
        original_line = lines[line_index]
        effective_line = original_line
        if line_index == start_line:
            local_start = max(0, select_start - offsets[line_index])
            effective_line = effective_line[local_start:]
        if line_index == end_line:
            local_end = max(0, min(len(effective_line), select_end - offsets[line_index]))
            effective_line = effective_line[:local_end]
        if not effective_line.strip() and current is None:
            continue
        if not effective_line.strip() and line_index == end_line:
            if current:
                items.append(current)
            current = None
            break

        code_only, _ = _strip_inline_comment(effective_line)
        stripped_code = code_only.lstrip()

        starts_with_leading_comma = depth == 0 and bool(re.match(r"^,\s*", stripped_code))
        if starts_with_leading_comma and current:
            current["end_line"] = line_index - 1
            items.append(current)
            current = None

        if current is None:
            current = {
                "start_line": line_index,
                "end_line": line_index,
                "lines": [],
            }

        current["lines"].append(effective_line)
        current["end_line"] = line_index

        depth += _line_depth_delta(effective_line)

        code_without_comment = code_only.rstrip()
        ends_with_trailing_comma = depth == 0 and code_without_comment.endswith(",")
        if ends_with_trailing_comma:
            items.append(current)
            current = None

    if current:
        items.append(current)
    return items


def _extract_select_expression(text: str):
    candidate = str(text or "").strip()
    if not candidate:
        raise ValueError("対象の式が空です。")
    statement = parse_one(f"SELECT {candidate}", read="bigquery")
    expressions = getattr(statement, "expressions", None) or []
    if not expressions:
        raise ValueError("対象の式を解釈できません。")
    return expressions[0]


def _strip_alias_suffix(text: str):
    candidate = str(text or "").strip()
    return re.sub(
        r"\s+AS\s+(?:`[^`]+`|\"[^\"]+\"|[A-Za-z_][\w$]*)\s*$",
        "",
        candidate,
        flags=re.IGNORECASE | re.DOTALL,
    )


def _normalize_expression_sql(text: str):
    candidate = str(text or "").strip()
    expression = _extract_select_expression(candidate)
    if isinstance(expression, exp.Alias):
        return _strip_alias_suffix(candidate)
    return candidate


def _resolve_alias_name(expression_sql: str):
    normalized = str(expression_sql or "").strip()
    expression = _extract_select_expression(normalized)
    if isinstance(expression, exp.Alias):
        expression = expression.this
        normalized = _strip_alias_suffix(normalized)

    if isinstance(expression, exp.Star):
        return None

    if isinstance(expression, exp.Column):
        base_name = str(expression.name or "").strip()
        if not base_name:
            return None
        if "." in normalized:
            return base_name
        return normalized

    return "column"


def _transform_item_lines(lines, measure_type: str):
    non_empty_indexes = [index for index, line in enumerate(lines) if str(line).strip()]
    if not non_empty_indexes:
        return lines
    first_index = non_empty_indexes[0]
    last_index = non_empty_indexes[-1]
    first_line = lines[first_index]
    last_line = lines[last_index]

    first_code, _ = _strip_inline_comment(first_line)
    last_code, last_comment = _strip_inline_comment(last_line)

    indent_match = re.match(r"^(\s*)", first_line)
    indent = indent_match.group(1) if indent_match else ""
    leading_comma_match = re.match(r"^\s*(,\s*)", first_code)
    leading_comma = leading_comma_match.group(1) if leading_comma_match else ""

    cleaned_lines = []
    for index, line in enumerate(lines):
        code_only, _ = _strip_inline_comment(line)
        current = code_only
        if index == first_index and leading_comma:
            current = re.sub(r"^\s*,\s*", "", current, count=1)
        if index == last_index:
            current = re.sub(r",\s*$", "", current)
        cleaned_lines.append(current.rstrip())

    expression_text = "\n".join(cleaned_lines).strip()
    if not expression_text:
        raise ValueError("対象の式が空です。")
    expression_sql = _normalize_expression_sql(expression_text)
    alias_base = _resolve_alias_name(expression_text)
    if not alias_base:
        return list(lines)

    if measure_type == "count":
        measure_sql = f"COUNT(DISTINCT {expression_sql})"
        alias_sql = f"{alias_base}_count" if alias_base != "column" else "column_count"
    else:
        measure_sql = f"SUM({expression_sql})"
        alias_sql = alias_base

    trailing_comma = "," if re.search(r",\s*$", last_code or "") else ""
    inline_comment = last_comment.strip()
    line = f"{indent}{leading_comma}{measure_sql} AS {alias_sql}{trailing_comma} --@measure"
    if inline_comment:
        line = f"{line} {inline_comment}"

    return [line]


def apply_measure_command(sql_text: str, *, measure_type: str, selection_start_line: int, selection_end_line: int):
    if measure_type not in {"sum", "count"}:
        raise ValueError("measure_type が不正です。")

    lines = str(sql_text or "").splitlines()
    items = _group_select_items(
        sql_text,
        selection_start_line=selection_start_line,
        selection_end_line=selection_end_line,
    )
    if not items:
        raise ValueError("SELECT 項目を特定できません。")

    start_line = min(int(selection_start_line), int(selection_end_line))
    end_line = max(int(selection_start_line), int(selection_end_line))
    transformed = []
    line_index = 0
    item_by_start = {item["start_line"]: item for item in items}

    while line_index < len(lines):
        item = item_by_start.get(line_index)
        if not item:
            transformed.append(lines[line_index])
            line_index += 1
            continue

        overlaps = not (item["end_line"] < start_line or item["start_line"] > end_line)
        if overlaps:
            transformed.extend(_transform_item_lines(item["lines"], measure_type))
        else:
            transformed.extend(item["lines"])
        line_index = item["end_line"] + 1

    return "\n".join(transformed)
