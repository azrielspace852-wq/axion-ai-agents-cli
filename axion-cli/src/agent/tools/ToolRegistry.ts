import {
  AgentTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from '../../types';

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, output: `Unknown tool: ${name}` };
    try {
      const safeArgs = typeof args === 'object' && args !== null && !Array.isArray(args)
        ? args
        : {};
      return await tool.execute(safeArgs, ctx);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, output: `Tool error: ${msg}` };
    }
  }
}