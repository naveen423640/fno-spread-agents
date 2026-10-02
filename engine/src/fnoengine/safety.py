from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class LiveExecutionRefused(RuntimeError):
    pass


@dataclass(frozen=True)
class ExecutionSettings:
    execution_mode: str = "paper"
    live_execution_enabled: bool = False


def read_execution_settings(env: Mapping[str, str] | None = None) -> ExecutionSettings:
    env = os.environ if env is None else env
    mode = env.get("EXECUTION_MODE", "paper")
    live = env.get("LIVE_EXECUTION_ENABLED", "false")
    if mode != "paper":
        raise LiveExecutionRefused(f'EXECUTION_MODE must be "paper" (got "{mode}"). Live execution is disabled in this system.')
    if live != "false":
        raise LiveExecutionRefused('LIVE_EXECUTION_ENABLED must be "false". Live execution is disabled in this system.')
    return ExecutionSettings()


def assert_paper_only(env: Mapping[str, str] | None = None) -> None:
    read_execution_settings(env)
