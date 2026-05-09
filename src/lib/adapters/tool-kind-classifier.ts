export type ToolKindLabel =
  | "search"
  | "command"
  | "read"
  | "edit"
  | "fetch"
  | "think"
  | "todo"
  | "task"
  | "other"

export const TOOL_KIND_ORDER: ToolKindLabel[] = [
  "search",
  "read",
  "edit",
  "command",
  "fetch",
  "task",
  "todo",
  "think",
  "other",
]

/**
 * Identify agent-like tool calls that own their own card-style rendering
 * (e.g. AgentToolCallPart). These should not be folded into a tool-group;
 * they each break the run and render standalone.
 */
export function isAgentLikeToolName(toolName: string): boolean {
  const name = toolName.toLowerCase().trim()
  return name === "agent"
}

export function classifyToolKind(toolName: string): ToolKindLabel {
  const name = toolName.toLowerCase().trim()

  if (
    name === "grep" ||
    name === "glob" ||
    name === "search" ||
    name === "find" ||
    name === "list_files" ||
    name === "list_code_definition_names"
  ) {
    return "search"
  }

  if (
    name === "bash" ||
    name === "exec_command" ||
    name === "shell" ||
    name === "execute_command" ||
    name === "run_command"
  ) {
    return "command"
  }

  if (
    name === "read" ||
    name === "read file" ||
    name === "read_file" ||
    name === "view"
  ) {
    return "read"
  }

  if (
    name === "edit" ||
    name === "write" ||
    name === "notebookedit" ||
    name === "apply_patch" ||
    name === "str_replace" ||
    name === "create_file" ||
    name === "write_to_file" ||
    name === "replace_in_file"
  ) {
    return "edit"
  }

  if (
    name === "webfetch" ||
    name === "websearch" ||
    name === "fetch" ||
    name === "browser" ||
    name === "browser_action" ||
    name === "web_search"
  ) {
    return "fetch"
  }

  if (
    name === "think" ||
    name === "sequentialthinking" ||
    name === "enterplanmode" ||
    name === "exitplanmode" ||
    name === "switch_mode"
  ) {
    return "think"
  }

  if (
    name === "todowrite" ||
    name === "tasklist" ||
    name === "taskcreate" ||
    name === "taskupdate" ||
    name === "update_todo_list"
  ) {
    return "todo"
  }

  if (
    name === "task" ||
    name === "agent" ||
    name === "skill" ||
    name === "new_task" ||
    name === "attempt_completion"
  ) {
    return "task"
  }

  return "other"
}
