import { Bot, CheckCircle2, FileCode2, Sparkles } from "lucide-react";
import { Card } from "../components/ui/Card";
import Editor from "@monaco-editor/react";

export default function LLMHomeScriptGuide() {
  const authMarkdown = `# Authentication For HomeScript API Calls

Use these headers on every request:

- x-service-id: <service_account_id>
- x-service-secret: <service_account_secret>

## Endpoint

POST /api/run/<script-endpoint>

## Example (curl)

\`\`\`bash
curl -X POST "https://your-host/api/run/lights-on" \\
  -H "Content-Type: application/json" \\
  -H "x-service-id: svc_123..." \\
  -H "x-service-secret: sk_abc..." \\
  -d '{"room":"kitchen"}'
\`\`\`

## LLM Prompt Rule

When generating API request examples, always include:
1. x-service-id
2. x-service-secret
3. Content-Type: application/json
4. valid JSON body
`;
  const usageMarkdown = `# HomeScript Detailed Usage Guidelines

## 1) Core Syntax

- Keywords are uppercase (SET, PRINT, IF, WHILE, CALL, GET, IMPORT, FUNCTION).
- Variables use the $name format.
- Comments start with #.
- One statement per line is recommended.

## 2) Data And Expressions

- Assign local variables:
  - SET $temperature = 23
  - SET $isHot = $temperature > 25
- Expressions support JS-like operators:
  - arithmetic: +, -, *, /
  - comparisons: ==, !=, >, <, >=, <=
  - boolean: &&, ||, !
- String literals use double quotes:
  - SET $room = "kitchen"

## 3) Commands

### PRINT
- Emits output line to execution console.
- Example: PRINT "Started"

### GET
- Reads Home Assistant entity state into variable.
- Format: GET domain.entity INTO $var
- Example: GET sensor.outdoor_temp INTO $outside

### SET
- Local variable assignment:
  - SET $target = 22
- Home Assistant entity state/service-style set:
  - SET input_number.desired_temp = 22

### CALL
- Calls a Home Assistant service.
- Format: CALL domain.service(args)
- Example with entity id:
  - CALL light.turn_on("light.kitchen")
- Example with object payload:
  - CALL climate.set_temperature({"entity_id":"climate.office","temperature":22})

## 4) Flow Control

### IF / ELSE / END_IF
~~~
IF $temperature > 25
  PRINT "Cooling"
ELSE
  PRINT "No action"
END_IF
~~~

### WHILE / END_WHILE
~~~
SET $i = 0
WHILE $i < 3 DO
  PRINT $i
  SET $i = $i + 1
END_WHILE
~~~

Notes:
- Always include DO in WHILE.
- Engine enforces max loop iterations to prevent infinite loops.

## 5) Functions And Imports

### FUNCTION
~~~
FUNCTION cool_if_needed($temp)
  IF $temp > 25
    CALL fan.turn_on("switch.office_fan")
  END_IF
END_FUNCTION
~~~

### Calling Function
~~~
CALL cool_if_needed($temperature)
~~~

### IMPORT
~~~
IMPORT "shared-cooling-rules"
~~~

Use imports for reusable logic by script endpoint name.

## 6) API Execution Model

- Save script with endpoint, example: \`night-cooling\`.
- Trigger:
  - POST /api/run/night-cooling (authenticated)
  - POST /api/webhook/night-cooling (webhook)
- Request JSON body becomes variables:
  - \`{"temperature": 27, "room":"office"}\`
  - accessible as $temperature, $room.

## 7) Error Handling And Debugging

- Syntax errors include line information.
- Use PRINT checkpoints to trace flow.
- Use debugger mode with breakpoints for step execution.
- Keep scripts small and deterministic for easier troubleshooting.

## 8) LLM Generation Rules (Recommended)

- Return code only (no prose around script).
- Always close blocks (END_IF, END_WHILE, END_FUNCTION).
- Prefer explicit entity ids and payload keys.
- Keep side effects intentional:
  - read state (GET) before write (SET / CALL).
- Include at least one PRINT outcome line.

## 9) Good Script Template

~~~
GET sensor.office_temperature INTO $temperature
SET $target = 22

IF $temperature > 25
  CALL climate.set_temperature({"entity_id":"climate.office","temperature":$target})
  PRINT "Cooling applied"
ELSE
  PRINT "Temperature acceptable"
END_IF
~~~
`;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold text-white mb-3 flex items-center gap-3">
          <Bot className="w-8 h-8 text-emerald-400" />
          LLM Friendly HomeScript Guide
        </h1>
        <p className="text-zinc-400">
          Use this page to write prompts and scripts that are predictable, safe, and easy for an LLM to generate.
        </p>
      </header>

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-xl font-medium text-white mb-4">Authentication (LLM-safe)</h2>
          <p className="text-zinc-300 mb-4">
            Always instruct the LLM to use <code className="bg-zinc-800 px-2 py-0.5 rounded">x-service-id</code> and{" "}
            <code className="bg-zinc-800 px-2 py-0.5 rounded">x-service-secret</code>. Do not use legacy single-key examples.
          </p>
          <div className="border border-zinc-800 rounded-xl overflow-hidden">
            <Editor
              height="420px"
              defaultLanguage="markdown"
              theme="vs-dark"
              value={authMarkdown}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                wordWrap: "on",
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
              }}
            />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-medium text-white mb-4">Detailed HomeScript Usage</h2>
          <div className="border border-zinc-800 rounded-xl overflow-hidden">
            <Editor
              height="900px"
              defaultLanguage="markdown"
              theme="vs-dark"
              value={usageMarkdown}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                wordWrap: "on",
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
              }}
            />
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-medium text-white mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Prompt Pattern
          </h2>
          <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm text-zinc-300 overflow-x-auto">
{`Generate HomeScript only.
Rules:
- Use uppercase keywords.
- Use one statement per line.
- Always include END_IF / END_WHILE.
- Prefer explicit variables ($temperature, $entity).
- Return only script code, no explanation.`}
          </pre>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-medium text-white mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Authoring Rules For LLM Output
          </h2>
          <ul className="list-disc list-inside text-zinc-300 space-y-2">
            <li>Start with `GET` or `SET` lines to initialize state.</li>
            <li>Prefer simple conditions with explicit comparisons.</li>
            <li>Use `CALL domain.service("entity_id")` format consistently.</li>
            <li>Print meaningful checkpoints using `PRINT` for observability.</li>
            <li>Avoid nested logic when a flat flow is possible.</li>
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-medium text-white mb-4 flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-indigo-400" />
            Example LLM-Friendly Script
          </h2>
          <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm text-emerald-300 overflow-x-auto">
{`GET sensor.office_temperature INTO $temperature
IF $temperature > 25
  CALL climate.set_temperature({"entity_id":"climate.office","temperature":22})
  PRINT "Cooling enabled"
ELSE
  PRINT "No cooling required"
END_IF`}
          </pre>
        </Card>
      </div>
    </div>
  );
}
