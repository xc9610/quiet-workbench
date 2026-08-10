export type WorkflowStepType =
  | "form"
  | "select"
  | "preview"
  | "confirm"
  | "write"
  | "done";

export interface WorkflowField {
  id: string;
  label: string;
  required?: boolean;
  defaultValue?: unknown;
  validate?: (value: unknown, context: WorkflowContext) => string | undefined;
}

export interface WorkflowOption {
  value: string;
  label: string;
  description?: string;
}

interface WorkflowStepBase {
  id: string;
  title?: string;
  next?: string;
}

export interface FormWorkflowStep extends WorkflowStepBase {
  type: "form";
  fields: WorkflowField[];
  bind?: string;
}

export interface SelectWorkflowStep extends WorkflowStepBase {
  type: "select";
  options: WorkflowOption[] | ((context: WorkflowContext) => WorkflowOption[]);
  bind: string;
}

export interface PreviewWorkflowStep extends WorkflowStepBase {
  type: "preview";
  render: (context: WorkflowContext) => unknown;
}

export interface ConfirmWorkflowStep extends WorkflowStepBase {
  type: "confirm";
  message: string | ((context: WorkflowContext) => string);
}

export interface WriteWorkflowStep extends WorkflowStepBase {
  type: "write";
  execute: (context: WorkflowContext) => unknown;
  bind?: string;
}

export interface DoneWorkflowStep extends WorkflowStepBase {
  type: "done";
  result?: (context: WorkflowContext) => unknown;
}

export type WorkflowStep =
  | FormWorkflowStep
  | SelectWorkflowStep
  | PreviewWorkflowStep
  | ConfirmWorkflowStep
  | WriteWorkflowStep
  | DoneWorkflowStep;

export interface WorkflowDefinition {
  id: string;
  title: string;
  start?: string;
  steps: WorkflowStep[];
}

export interface WorkflowSnapshot {
  workflowId: string;
  stepId: string;
  depth: number;
  values: Readonly<Record<string, unknown>>;
}

export type WorkflowSubmissionResult =
  | { status: "active"; snapshot: WorkflowSnapshot }
  | { status: "completed"; result: unknown; parent?: WorkflowSnapshot }
  | { status: "cancelled"; parent?: WorkflowSnapshot };

/**
 * A scoped value bag. Child workflows inherit parent values without mutating
 * them until their result is explicitly returned to the parent.
 */
export class WorkflowContext {
  private readonly values = new Map<string, unknown>();

  constructor(
    initial: Record<string, unknown> = {},
    public readonly parent?: WorkflowContext
  ) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value);
    }
  }

  get<T = unknown>(key: string): T | undefined {
    if (this.values.has(key)) {
      return this.values.get(key) as T;
    }
    return this.parent?.get<T>(key);
  }

  hasOwn(key: string): boolean {
    return this.values.has(key);
  }

  set(key: string, value: unknown): void {
    if (!key.trim()) throw new Error("Context key is required");
    this.values.set(key, value);
  }

  assign(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) this.set(key, value);
  }

  child(initial: Record<string, unknown> = {}): WorkflowContext {
    return new WorkflowContext(initial, this);
  }

  ownValues(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }

  snapshot(): Record<string, unknown> {
    return { ...(this.parent?.snapshot() ?? {}), ...this.ownValues() };
  }
}

interface WorkflowFrame {
  definition: WorkflowDefinition;
  steps: Map<string, WorkflowStep>;
  order: string[];
  currentId: string;
  context: WorkflowContext;
  resultKey?: string;
}

export class WorkflowEngine {
  private readonly frames: WorkflowFrame[] = [];

  start(
    definition: WorkflowDefinition,
    initial: Record<string, unknown> = {}
  ): WorkflowSnapshot {
    if (this.frames.length > 0) {
      throw new Error("A workflow is already active; use beginNested for a child workflow");
    }
    this.frames.push(createFrame(definition, new WorkflowContext(initial)));
    return this.snapshot();
  }

  beginNested(
    definition: WorkflowDefinition,
    initial: Record<string, unknown> = {},
    resultKey?: string
  ): WorkflowSnapshot {
    const parent = this.currentFrame();
    this.frames.push(createFrame(definition, parent.context.child(initial), resultKey));
    return this.snapshot();
  }

  get depth(): number {
    return this.frames.length;
  }

  get context(): WorkflowContext {
    return this.currentFrame().context;
  }

  currentStep(): WorkflowStep {
    const frame = this.currentFrame();
    return requireStep(frame, frame.currentId);
  }

  preview(): unknown {
    const step = this.currentStep();
    if (step.type !== "preview") throw new Error("Current step is not a preview");
    return step.render(this.context);
  }

  confirmationMessage(): string {
    const step = this.currentStep();
    if (step.type !== "confirm") throw new Error("Current step is not a confirmation");
    return typeof step.message === "function" ? step.message(this.context) : step.message;
  }

  async submit(input?: unknown): Promise<WorkflowSubmissionResult> {
    const frame = this.currentFrame();
    const step = requireStep(frame, frame.currentId);

    switch (step.type) {
      case "form":
        submitForm(step, input, frame.context);
        break;
      case "select":
        submitSelect(step, input, frame.context);
        break;
      case "preview":
        break;
      case "confirm":
        if (input !== true) return this.cancelFrame();
        break;
      case "write": {
        const output = await step.execute(frame.context);
        if (step.bind) frame.context.set(step.bind, output);
        break;
      }
      case "done":
        return this.completeFrame(step.result?.(frame.context) ?? frame.context.ownValues());
    }

    frame.currentId = nextStepId(frame, step);
    return { status: "active", snapshot: this.snapshot() };
  }

  cancel(): WorkflowSubmissionResult {
    return this.cancelFrame();
  }

  snapshot(): WorkflowSnapshot {
    const frame = this.currentFrame();
    return {
      workflowId: frame.definition.id,
      stepId: frame.currentId,
      depth: this.frames.length,
      values: Object.freeze(frame.context.snapshot())
    };
  }

  private completeFrame(result: unknown): WorkflowSubmissionResult {
    const completed = this.frames.pop();
    if (!completed) throw new Error("No active workflow");
    const parent = this.frames.at(-1);
    if (parent && completed.resultKey) {
      parent.context.set(completed.resultKey, result);
    }
    return {
      status: "completed",
      result,
      parent: parent ? this.snapshot() : undefined
    };
  }

  private cancelFrame(): WorkflowSubmissionResult {
    if (this.frames.length === 0) throw new Error("No active workflow");
    this.frames.pop();
    const parent = this.frames.at(-1);
    return { status: "cancelled", parent: parent ? this.snapshot() : undefined };
  }

  private currentFrame(): WorkflowFrame {
    const frame = this.frames.at(-1);
    if (!frame) throw new Error("No active workflow");
    return frame;
  }
}

export class WorkflowValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(Object.entries(fieldErrors).map(([field, message]) => `${field}: ${message}`).join("; "));
    this.name = "WorkflowValidationError";
  }
}

function createFrame(definition: WorkflowDefinition, context: WorkflowContext, resultKey?: string): WorkflowFrame {
  validateDefinition(definition);
  const order = definition.steps.map((step) => step.id);
  return {
    definition,
    steps: new Map(definition.steps.map((step) => [step.id, step])),
    order,
    currentId: definition.start ?? order[0],
    context,
    resultKey
  };
}

function validateDefinition(definition: WorkflowDefinition): void {
  if (!/^[a-z][a-z0-9.-]*$/.test(definition.id)) throw new Error(`Invalid workflow id: ${definition.id}`);
  if (!definition.title.trim()) throw new Error("Workflow title is required");
  if (definition.steps.length === 0) throw new Error("Workflow must have at least one step");
  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (!step.id.trim()) throw new Error("Workflow step id is required");
    if (ids.has(step.id)) throw new Error(`Duplicate workflow step: ${step.id}`);
    ids.add(step.id);
  }
  if (definition.start && !ids.has(definition.start)) throw new Error(`Unknown start step: ${definition.start}`);
  for (const step of definition.steps) {
    if (step.next && !ids.has(step.next)) throw new Error(`Unknown next step: ${step.next}`);
  }
}

function nextStepId(frame: WorkflowFrame, step: WorkflowStep): string {
  if (step.next) return step.next;
  const index = frame.order.indexOf(step.id);
  const next = frame.order[index + 1];
  if (!next) throw new Error(`Step ${step.id} has no next step`);
  return next;
}

function requireStep(frame: WorkflowFrame, id: string): WorkflowStep {
  const step = frame.steps.get(id);
  if (!step) throw new Error(`Unknown workflow step: ${id}`);
  return step;
}

function submitForm(step: FormWorkflowStep, input: unknown, context: WorkflowContext): void {
  if (!isRecord(input)) throw new WorkflowValidationError({ $: "Form data must be an object" });
  const output: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of step.fields) {
    const value = input[field.id] ?? field.defaultValue;
    if (field.required && (value === undefined || value === null || value === "")) {
      errors[field.id] = "Required";
      continue;
    }
    const message = field.validate?.(value, context);
    if (message) errors[field.id] = message;
    output[field.id] = value;
  }
  if (Object.keys(errors).length > 0) throw new WorkflowValidationError(errors);
  if (step.bind) context.set(step.bind, output);
  else context.assign(output);
}

function submitSelect(step: SelectWorkflowStep, input: unknown, context: WorkflowContext): void {
  if (typeof input !== "string") throw new WorkflowValidationError({ [step.bind]: "A selection is required" });
  const options = typeof step.options === "function" ? step.options(context) : step.options;
  if (!options.some((option) => option.value === input)) {
    throw new WorkflowValidationError({ [step.bind]: "Invalid selection" });
  }
  context.set(step.bind, input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
