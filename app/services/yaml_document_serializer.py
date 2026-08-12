import re

import yaml


_CANONICAL_ID_PATTERN = re.compile(
    r"(?:0[1-9]|[1-9][0-9]|[1-9][0-9]{2,})"
)


class _QuotedValue(str):
    pass


class _DynamicIdKey(str):
    pass


class _DocumentDumper(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True


def _represent_quoted_value(dumper, value):
    text = str(value)
    style = "|" if "\n" in text else "'"
    return dumper.represent_scalar(
        "tag:yaml.org,2002:str",
        text,
        style=style,
    )


def _represent_dynamic_id_key(dumper, value):
    return dumper.represent_scalar(
        "tag:yaml.org,2002:str",
        str(value),
        style="'",
    )


_DocumentDumper.add_representer(
    _QuotedValue,
    _represent_quoted_value,
)
_DocumentDumper.add_representer(
    _DynamicIdKey,
    _represent_dynamic_id_key,
)


def _is_dynamic_id_key(path, key):
    if not isinstance(key, str):
        return False
    if _CANONICAL_ID_PATTERN.fullmatch(key) is None:
        return False
    return path in {("flows",), ("loop", "flows")}


def _prepare(value, path=()):
    if isinstance(value, dict):
        prepared = {}
        for key, item in value.items():
            next_path = path + (str(key),)
            prepared_item = _prepare(item, next_path)
            if isinstance(prepared_item, dict) and not prepared_item:
                continue
            prepared_key = (
                _DynamicIdKey(key)
                if _is_dynamic_id_key(path, key)
                else key
            )
            prepared[prepared_key] = prepared_item
        return prepared
    if isinstance(value, list):
        return [_prepare(item, path) for item in value]
    if isinstance(value, str):
        return _QuotedValue(value)
    return value


def dump_workflow_document(document, stream):
    yaml.dump(
        _prepare(document),
        stream,
        Dumper=_DocumentDumper,
        allow_unicode=True,
        default_flow_style=False,
        indent=2,
        line_break="\n",
        sort_keys=False,
        width=100000,
    )
