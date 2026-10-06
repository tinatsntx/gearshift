"""Redact SDK transport validation before any value-bearing diagnostic can be emitted."""

import logging
import sys


class FixedDiagnosticFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # SDK envelope/notification validation happens before our tool handler.
        # Do not format the original message/args or traceback, even temporarily.
        record.msg = "protocol_diagnostic_redacted"
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True


def configure_redacted_logging() -> None:
    """Standalone plugin-process logging only; never write logs or alter app settings."""
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(levelname)s:%(message)s"))
        root.addHandler(handler)
    root.setLevel(logging.WARNING)
    loggers = [root] + [value for value in logging.Logger.manager.loggerDict.values()
                        if isinstance(value, logging.Logger)]
    for logger in loggers:
        for handler in logger.handlers:
            if not any(isinstance(item, FixedDiagnosticFilter) for item in handler.filters):
                handler.addFilter(FixedDiagnosticFilter())
    logging.getLogger("httpx").setLevel(logging.CRITICAL)
    logging.getLogger("httpcore").setLevel(logging.CRITICAL)
