# homebrew VS Code style Shell Integration for BusyBox ash
# due to ash limitation only some basic features work

if [ -n "${VSCODE_SHELL_INTEGRATION:-}" ]; then
  return
fi

VSCODE_SHELL_INTEGRATION=1

# Fallback if PS1 is currently empty or unset
: "${PS1:=\h:\w\$ }"

# Sequence breakdown:
# 1. \e]633;D;$?\a        -> Signal command finished & report exit code ($?)
# 2. \e]633;A\a           -> Mark Prompt Start
# 3. \e]633;P;Cwd=$PWD\a  -> Report Working Directory ($PWD)
# 4. ${PS1}               -> Draw original prompt
# 5. \e]633;B\a           -> Mark Prompt End / Command Input Start
# Note: '$PWD' is single-quoted so ash evaluates $PWD dynamically EVERY time the prompt renders,
# rather than evaluating it only once when this script runs.
export PS1='\[\e]633;D;$?\a\]\[\e]633;A\a\]\[\e]633;P;Cwd=$PWD\a\]'"${PS1}"'\[\e]633;B\a\]'
