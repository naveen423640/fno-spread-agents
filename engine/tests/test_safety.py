import pytest

from fnoengine.safety import LiveExecutionRefused, read_execution_settings


def test_defaults_are_paper_and_live_off():
    s = read_execution_settings({})
    assert (s.execution_mode, s.live_execution_enabled) == ("paper", False)


@pytest.mark.parametrize("mode", ["live", "Paper", " paper", "paper ", "", "real"])
def test_refuses_any_other_mode(mode):
    with pytest.raises(LiveExecutionRefused):
        read_execution_settings({"EXECUTION_MODE": mode})


@pytest.mark.parametrize("value", ["true", "TRUE", "False", "0", "1", "yes", " false", ""])
def test_refuses_any_live_value_but_exact_false(value):
    with pytest.raises(LiveExecutionRefused):
        read_execution_settings({"LIVE_EXECUTION_ENABLED": value})
