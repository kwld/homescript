import { evaluateHomeScriptExpression } from "./homescript/expression.js";
import { collectIfCondition, ScriptLine } from "./homescript/if-condition.js";

export class HomeScriptError extends Error {
  constructor(message: string, public line: number) {
    super(`[Line ${line}] ${message}`);
    this.name = "HomeScriptError";
  }
}

export interface HomeScriptOptions {
  variables?: Record<string, any>;
  onCall?: (service: string, args: any[]) => Promise<any>;
  onGet?: (entityId: string) => Promise<any>;
  onSet?: (entityId: string, state: any) => Promise<any>;
  importCallback?: (name: string) => Promise<string>;
  debug?: boolean;
  breakpoints?: number[];
  onBreakpoint?: (line: number, variables: Record<string, any>) => Promise<"CONTINUE" | "STEP" | "STOP">;
  onEvent?: (event: HomeScriptTraceEvent) => void;
}

export interface FunctionDef {
  name: string;
  args: string[];
  startLine: number;
  endLine: number;
}

export interface HomeScriptTraceEvent {
  type: string;
  message: string;
  line?: number;
  level?: "info" | "success" | "warning" | "error";
  details?: Record<string, any>;
}

export class HomeScriptEngine {
  private variables: Record<string, any> = {};
  private output: string[] = [];
  private onCall?: (service: string, args: any[]) => Promise<any>;
  private onGet?: (entityId: string) => Promise<any>;
  private onSet?: (entityId: string, state: any) => Promise<any>;
  private functions: Map<string, FunctionDef> = new Map();
  private importedScripts: Set<string> = new Set();
  private importCallback?: (name: string) => Promise<string>;
  private debug: boolean = false;
  private breakpoints: Set<number> = new Set();
  private onBreakpoint?: (line: number, variables: Record<string, any>) => Promise<"CONTINUE" | "STEP" | "STOP">;
  private onEvent?: (event: HomeScriptTraceEvent) => void;
  private isStepping: boolean = false;
  
  constructor(options: HomeScriptOptions = {}) {
    this.variables = { ...(options.variables || {}) };
    this.onCall = options.onCall;
    this.onGet = options.onGet;
    this.onSet = options.onSet;
    this.importCallback = options.importCallback;
    this.debug = !!options.debug;
    this.breakpoints = new Set(options.breakpoints || []);
    this.onBreakpoint = options.onBreakpoint;
    this.onEvent = options.onEvent;
  }

  public async execute(code: string): Promise<{ output: string[], variables: Record<string, any> }> {
    this.emitEvent({ type: "execution_start", level: "info", message: "Execution started" });
    const lines: ScriptLine[] = code.split('\n').map((l, i) => ({ content: l.trim(), lineNumber: i + 1 }));
    
    // First pass: Register functions
    await this.registerFunctions(lines);

    await this.executeBlock(lines, 0, lines.length);
    this.emitEvent({ type: "execution_end", level: "success", message: "Execution completed" });
    return { output: this.output, variables: this.variables };
  }

  private emitEvent(event: HomeScriptTraceEvent) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  private async registerFunctions(lines: ScriptLine[]): Promise<void> {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].content;
      const match = line.match(/^FUNCTION\s+([a-zA-Z0-9_]+)\((.*)\)$/);
      
      if (match) {
        const name = match[1];
        const args = match[2].split(',').map(a => a.trim()).filter(a => a.length > 0);
        const startLine = i;
        
        // Find end of function
        let depth = 0;
        let endLine = -1;
        
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j].content;
          if (l.startsWith('FUNCTION')) depth++;
          else if (l === 'END_FUNCTION') {
            if (depth === 0) {
              endLine = j;
              break;
            }
            depth--;
          }
        }
        
        if (endLine === -1) {
          throw new HomeScriptError(`Missing END_FUNCTION for ${name}`, lines[i].lineNumber);
        }
        
        this.functions.set(name, { name, args, startLine, endLine });
        i = endLine + 1;
      } else {
        i++;
      }
    }
  }

  private async executeBlock(lines: ScriptLine[], start: number, end: number): Promise<void> {
    let i = start;
    while (i < end) {
      const lineObj = lines[i];
      const line = lineObj.content;
      
      if (line.length === 0 || line.startsWith('#')) {
        i++;
        continue;
      }

      this.emitEvent({
        type: "line_execute",
        level: "info",
        line: lineObj.lineNumber,
        message: `Executing: ${line}`,
      });

      // Debugger Check
      if (this.debug && (this.breakpoints.has(lineObj.lineNumber) || this.isStepping)) {
        if (this.onBreakpoint) {
            const action = await this.onBreakpoint(lineObj.lineNumber, { ...this.variables });
            if (action === "STOP") {
                this.emitEvent({
                  type: "debug_stop",
                  level: "warning",
                  line: lineObj.lineNumber,
                  message: "Debugger stopped execution",
                });
                throw new HomeScriptError("Debugger stopped", lineObj.lineNumber);
            }
            this.isStepping = (action === "STEP");
        }
      }

      const tokens = line.split(/\s+/);
      const keyword = tokens[0];

      if (keyword === 'FUNCTION') {
        // Skip function definitions during execution
        // They are already registered and should only be entered via CALL
        const funcName = tokens[1].split('(')[0];
        const func = this.functions.get(funcName);
        if (func) {
            i = func.endLine + 1;
        } else {
            // Should not happen if registration worked
            i++; 
        }
      } else if (keyword === 'IMPORT') {
        await this.handleImport(line, lineObj.lineNumber);
        i++;
      } else if (keyword === 'SET') {
        await this.handleSet(line, lineObj.lineNumber);
        i++;
      } else if (keyword === 'PRINT') {
        this.handlePrint(line, lineObj.lineNumber);
        i++;
      } else if (keyword === 'GET') {
        await this.handleGet(line, lineObj.lineNumber);
        i++;
      } else if (keyword === 'CALL') {
        await this.handleCall(line, lineObj.lineNumber, lines);
        i++;
      } else if (keyword === 'IF') {
        i = await this.handleIf(lines, i, end);
      } else if (keyword === 'WHILE') {
        i = await this.handleWhile(lines, i, end);
      } else if (keyword === 'BREAK') {
        throw new HomeScriptError("BREAK outside of loop", lineObj.lineNumber);
      } else if (keyword === 'CONTINUE') {
        throw new HomeScriptError("CONTINUE outside of loop", lineObj.lineNumber);
      } else if (keyword === 'RETURN') {
        this.emitEvent({
          type: "return",
          level: "info",
          line: lineObj.lineNumber,
          message: "Function returned",
        });
        return; // Exit current block (function)
      } else if (keyword === 'ELSE' || keyword === 'END_IF' || keyword === 'END_WHILE' || keyword === 'END_FUNCTION') {
         // These should be handled by their respective block handlers
         i++;
      } else {
        this.emitEvent({
          type: "unknown_keyword",
          level: "error",
          line: lineObj.lineNumber,
          message: `Unknown keyword: ${keyword}`,
        });
        throw new HomeScriptError(`Unknown keyword: ${keyword}`, lineObj.lineNumber);
      }
    }
  }

  private async handleSet(line: string, lineNumber: number) {
    // Match SET $var = value OR SET domain.entity = value
    const matchVar = line.match(/^SET\s+\$([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    const matchEntity = line.match(/^SET\s+([a-zA-Z0-9_.]+)\s*=\s*(.+)$/);
    
    if (matchVar) {
      const varName = matchVar[1];
      const expr = matchVar[2];
      try {
        this.variables[varName] = this.evaluateExpression(expr);
        this.emitEvent({
          type: "set_variable",
          level: "success",
          line: lineNumber,
          message: `SET $${varName}`,
          details: { value: this.variables[varName] },
        });
      } catch (e) {
        throw new HomeScriptError(`Error evaluating assignment: ${expr}`, lineNumber);
      }
    } else if (matchEntity) {
      const entityId = matchEntity[1];
      const expr = matchEntity[2];
      let value;
      try {
        value = this.evaluateExpression(expr);
      } catch (e) {
        throw new HomeScriptError(`Error evaluating assignment: ${expr}`, lineNumber);
      }
      
      if (this.onSet) {
        try {
          await this.onSet(entityId, value);
          this.emitEvent({
            type: "set_entity",
            level: "success",
            line: lineNumber,
            message: `SET ${entityId}`,
            details: { value },
          });
        } catch (e: any) {
          this.emitEvent({
            type: "set_entity",
            level: "error",
            line: lineNumber,
            message: `SET failed for ${entityId}`,
            details: { error: e.message },
          });
          throw new HomeScriptError(`SET failed: ${e.message}`, lineNumber);
        }
      } else {
        this.output.push(`[Dry Run] SET ${entityId} = ${value}`);
      }
    } else {
      throw new HomeScriptError("Invalid SET syntax. Expected: SET $var = value OR SET domain.entity = value", lineNumber);
    }
  }

  private handlePrint(line: string, lineNumber: number) {
    const match = line.match(/^PRINT\s+(.+)$/);
    if (!match) throw new HomeScriptError("Invalid PRINT syntax. Expected: PRINT value", lineNumber);
    const expr = match[1];
    try {
      const value = this.evaluateExpression(expr);
      this.output.push(String(value));
      this.emitEvent({
        type: "print",
        level: "info",
        line: lineNumber,
        message: "PRINT emitted value",
        details: { value },
      });
    } catch (e) {
      throw new HomeScriptError(`Error evaluating print: ${expr}`, lineNumber);
    }
  }

  private async handleImport(line: string, lineNumber: number) {
    const match = line.match(/^IMPORT\s+"([^"]+)"$/);
    if (!match) throw new HomeScriptError("Invalid IMPORT syntax. Expected: IMPORT \"script_name\"", lineNumber);
    const scriptName = match[1];

    if (this.importedScripts.has(scriptName)) return; // Already imported
    this.importedScripts.add(scriptName);
    this.emitEvent({
      type: "import",
      level: "info",
      line: lineNumber,
      message: `Importing script: ${scriptName}`,
    });

    if (!this.importCallback) {
        throw new HomeScriptError("Imports are not supported in this environment", lineNumber);
    }

    try {
        const code = await this.importCallback(scriptName);
        // Execute imported code in the same context
        await this.execute(code);
        this.emitEvent({
          type: "import",
          level: "success",
          line: lineNumber,
          message: `Imported script: ${scriptName}`,
        });
    } catch (e: any) {
        this.emitEvent({
          type: "import",
          level: "error",
          line: lineNumber,
          message: `Import failed: ${scriptName}`,
          details: { error: e.message },
        });
        throw new HomeScriptError(`Failed to import '${scriptName}': ${e.message}`, lineNumber);
    }
  }

  private async handleGet(line: string, lineNumber: number) {
    const match = line.match(/^GET\s+([a-zA-Z0-9_.]+)\s+INTO\s+\$([a-zA-Z0-9_]+)$/);
    if (!match) throw new HomeScriptError("Invalid GET syntax. Expected: GET domain.entity INTO $var", lineNumber);
    const entityId = match[1];
    const varName = match[2];
    
    if (this.onGet) {
      try {
        this.variables[varName] = await this.onGet(entityId);
        this.emitEvent({
          type: "get_entity",
          level: "success",
          line: lineNumber,
          message: `GET ${entityId} INTO $${varName}`,
          details: { value: this.variables[varName] },
        });
      } catch (e: any) {
        this.emitEvent({
          type: "get_entity",
          level: "error",
          line: lineNumber,
          message: `GET failed for ${entityId}`,
          details: { error: e.message },
        });
        throw new HomeScriptError(`GET failed: ${e.message}`, lineNumber);
      }
    } else {
      this.output.push(`[Dry Run] GET ${entityId} INTO $${varName}`);
      this.variables[varName] = null;
    }
  }

  private async handleCall(line: string, lineNumber: number, lines: ScriptLine[] = []) {
    const match = line.match(/^CALL\s+([a-zA-Z0-9_.]+)\((.*)\)$/);
    if (!match) throw new HomeScriptError("Invalid CALL syntax. Expected: CALL service.action(args)", lineNumber);
    const serviceOrFunc = match[1];
    const argsStr = match[2];
    
    let args: any[] = [];
    if (argsStr.trim()) {
        try {
             // Basic comma splitting (fragile for nested calls)
             args = argsStr.split(',').map(a => this.evaluateExpression(a.trim()));
        } catch (e) {
             throw new HomeScriptError(`Error evaluating arguments: ${argsStr}`, lineNumber);
        }
    }
    
    // Check if it's a user defined function
    if (this.functions.has(serviceOrFunc)) {
        this.emitEvent({
          type: "call_function",
          level: "info",
          line: lineNumber,
          message: `CALL function ${serviceOrFunc}`,
          details: { args },
        });
        await this.executeFunction(serviceOrFunc, args, lines);
        return;
    }

    // Otherwise treat as service call
    if (this.onCall) {
      try {
        const result = await this.onCall(serviceOrFunc, args);
        this.emitEvent({
          type: "call_service",
          level: "success",
          line: lineNumber,
          message: `CALL ${serviceOrFunc}`,
          details: { args, result },
        });
        // this.output.push(`Called ${serviceOrFunc} -> ${JSON.stringify(result)}`);
      } catch (e: any) {
        this.emitEvent({
          type: "call_service",
          level: "error",
          line: lineNumber,
          message: `CALL failed for ${serviceOrFunc}`,
          details: { args, error: e.message },
        });
        throw new HomeScriptError(`CALL failed: ${e.message}`, lineNumber);
      }
    } else {
      this.output.push(`[Dry Run] Called ${serviceOrFunc} with args: ${JSON.stringify(args)}`);
    }
  }

  private async executeFunction(name: string, args: any[], lines: ScriptLine[]) {
      const func = this.functions.get(name);
      if (!func) throw new Error(`Function ${name} not found`); // Should be checked before

      if (args.length !== func.args.length) {
          throw new HomeScriptError(`Function ${name} expects ${func.args.length} arguments, got ${args.length}`, -1);
      }

      // Save current variables (simple stack simulation)
      // We only backup variables that are about to be overwritten by arguments
      const backup: Record<string, any> = {};
      func.args.forEach((argName, index) => {
          const varName = argName.replace('$', '');
          if (this.variables[varName] !== undefined) {
              backup[varName] = this.variables[varName];
          }
          this.variables[varName] = args[index];
      });

      try {
          await this.executeBlock(lines, func.startLine + 1, func.endLine);
      } finally {
          // Restore variables
          func.args.forEach((argName) => {
              const varName = argName.replace('$', '');
              if (backup[varName] !== undefined) {
                  this.variables[varName] = backup[varName];
              } else {
                  delete this.variables[varName];
              }
          });
      }
  }

  private async handleIf(lines: ScriptLine[], startIndex: number, maxEnd: number): Promise<number> {
    const lineObj = lines[startIndex];
    let parsedCondition;
    try {
      parsedCondition = collectIfCondition(lines, startIndex, maxEnd);
    } catch {
      throw new HomeScriptError("Invalid IF syntax", lineObj.lineNumber);
    }
    const conditionStart = parsedCondition.lastConditionLineIndex;

    // Collect all branches: IF, ELSE IF, ELSE
    const branches: { type: 'IF' | 'ELSE_IF' | 'ELSE', condition?: string, startLine: number, endLine: number }[] = [];
    
    let currentBranchStart = conditionStart;
    let currentCondition = parsedCondition.condition;
    let currentType: 'IF' | 'ELSE_IF' | 'ELSE' = 'IF';

    let depth = 0;
    let endIndex = -1;

    for (let i = conditionStart + 1; i < maxEnd; i++) {
      const content = lines[i].content;
      if (content.length === 0 || content.startsWith('#')) continue;

      const tokens = content.split(/\s+/);
      const kw = tokens[0];
      
      if (kw === 'IF') {
        depth++;
      } else if (kw === 'END_IF') {
        if (depth === 0) {
          // Close current branch
          branches.push({
            type: currentType,
            condition: currentCondition,
            startLine: currentBranchStart,
            endLine: i
          });
          endIndex = i;
          break;
        }
        depth--;
      } else if (depth === 0) {
        if (kw === 'ELSE') {
          if (tokens[1] === 'IF') {
            // ELSE IF (supports multiline condition continuation)
            const synthetic = [...lines];
            synthetic[i] = { ...lines[i], content: content.replace(/^ELSE\s+IF\s+/i, "IF ") };
            let elseIfParsed;
            try {
              elseIfParsed = collectIfCondition(synthetic, i, maxEnd);
            } catch {
              throw new HomeScriptError("Invalid ELSE IF syntax", lines[i].lineNumber);
            }
            
            // Close previous branch
            branches.push({
              type: currentType,
              condition: currentCondition,
              startLine: currentBranchStart,
              endLine: i
            });

            // Start new branch
            currentBranchStart = elseIfParsed.lastConditionLineIndex;
            currentCondition = elseIfParsed.condition;
            currentType = 'ELSE_IF';
            i = elseIfParsed.lastConditionLineIndex;
          } else {
            // ELSE
            // Close previous branch
            branches.push({
              type: currentType,
              condition: currentCondition,
              startLine: currentBranchStart,
              endLine: i
            });

            // Start new branch
            currentBranchStart = i;
            currentCondition = undefined; // No condition for ELSE
            currentType = 'ELSE';
          }
        }
      }
    }

    if (endIndex === -1) throw new HomeScriptError("Missing END_IF", lineObj.lineNumber);

    // Execute the first matching branch
    for (const branch of branches) {
      let shouldExecute = false;
      
      if (branch.type === 'ELSE') {
        shouldExecute = true;
      } else if (branch.condition) {
        try {
          shouldExecute = this.evaluateExpression(branch.condition);
          this.emitEvent({
            type: "if_condition",
            level: "info",
            line: lines[branch.startLine].lineNumber,
            message: `IF branch evaluated`,
            details: { condition: branch.condition, result: shouldExecute },
          });
        } catch (e) {
          throw new HomeScriptError(`Error evaluating condition: ${branch.condition}`, lines[branch.startLine].lineNumber);
        }
      }

      if (shouldExecute) {
        this.emitEvent({
          type: "if_branch_execute",
          level: "info",
          line: lines[branch.startLine].lineNumber,
          message: `Executing ${branch.type} branch`,
        });
        await this.executeBlock(lines, branch.startLine + 1, branch.endLine);
        break; // Only execute one branch
      }
    }

    return endIndex + 1;
  }

  private async handleWhile(lines: ScriptLine[], startIndex: number, maxEnd: number): Promise<number> {
    const lineObj = lines[startIndex];
    const match = lineObj.content.match(/^WHILE\s+(.+)\s+DO$/);
    if (!match) throw new HomeScriptError("Invalid WHILE syntax. Expected: WHILE condition DO", lineObj.lineNumber);

    const conditionStr = match[1];
    
    let depth = 0;
    let endIndex = -1;

    for (let i = startIndex + 1; i < maxEnd; i++) {
      const content = lines[i].content;
      if (content.length === 0 || content.startsWith('#')) continue;

      const kw = content.split(/\s+/)[0];
      if (kw === 'WHILE') depth++;
      else if (kw === 'END_WHILE') {
        if (depth === 0) { endIndex = i; break; }
        depth--;
      }
    }

    if (endIndex === -1) throw new HomeScriptError("Missing END_WHILE", lineObj.lineNumber);

    let iterations = 0;
    while (true) {
        let condition = false;
        try {
            condition = this.evaluateExpression(conditionStr);
            this.emitEvent({
              type: "while_condition",
              level: "info",
              line: lineObj.lineNumber,
              message: "WHILE condition evaluated",
              details: { condition: conditionStr, result: condition, iteration: iterations },
            });
        } catch (e) {
            throw new HomeScriptError(`Error evaluating condition: ${conditionStr}`, lineObj.lineNumber);
        }

        if (!condition) break;

        if (iterations++ > 1000) throw new HomeScriptError("Infinite loop detected (max 1000 iterations)", lineObj.lineNumber);
      
        try {
            await this.executeBlock(lines, startIndex + 1, endIndex);
        } catch (e: any) {
            if (e.message.includes('BREAK')) break;
            if (e.message.includes('CONTINUE')) continue;
            throw e;
        }
    }

    return endIndex + 1;
  }

  private evaluateExpression(expr: string): any {
    return evaluateHomeScriptExpression(expr, this.variables);
  }
}
