import { useEffect, useMemo, useRef, useState } from "react";

import { getBlockDefinitions, validateStep } from "../blockCatalog";
import { uiText, type Locale } from "../i18n";
import type { FlowStep, StepType } from "../types";

interface Props {
  locale: Locale;
  steps: FlowStep[];
  setSteps: (steps: FlowStep[]) => void;
  loadBlocks?: (locale: Locale) => Promise<BlockCatalogItem[]>;
  loadThirdPartyPackages?: (deviceSerial: string) => Promise<string[]>;
  uploadApk?: (file: File, onProgress?: (percent: number) => void) => Promise<string>;
  selectedDevice?: string;
  defaultStepTimeout?: number;
}

interface BlockCatalogItem {
  type: StepType;
  category: string;
  label: string;
  description: string;
  when_to_use: string;
  adb_command: string;
  is_condition: boolean;
  template?: {
    type: StepType;
    name: string;
    params: Record<string, string | number | boolean>;
    timeout_seconds?: number;
  };
  template_params?: Record<string, string | number | boolean>;
}

type CatalogState = "loading" | "ready" | "partial-success" | "error" | "empty";
type PickerMode = "add-tail" | "add-after" | "edit";

interface PickerContext {
  mode: PickerMode;
  index: number | null;
}

interface SimpleStepListEditorProps {
  locale: Locale;
  text: Record<string, string>;
  steps: FlowStep[];
  setSteps: (next: FlowStep[]) => void;
  stepTemplates: Record<StepType, FlowStep>;
  availableBlocks: BlockCatalogItem[];
  appPackages: string[];
  appPackagesLoading: boolean;
  uploadApk?: (file: File, onProgress?: (percent: number) => void) => Promise<string>;
  defaultStepTimeout?: number;
}

const APP_PACKAGE_TYPES: ReadonlySet<StepType> = new Set([
  "app_start",
  "app_force_stop",
  "app_clear_data",
  "uninstall_package",
]);

const BOOL_PARAM_KEYS = new Set(["allow_downgrade", "grant_permissions", "keep_data"]);

const KEYEVENT_PRESETS: Array<{ value: string; label: string }> = [
  { value: "3", label: "3: KEYCODE_HOME" },
  { value: "4", label: "4: KEYCODE_BACK" },
  { value: "66", label: "66: KEYCODE_ENTER" },
  { value: "24", label: "24: KEYCODE_VOLUME_UP" },
  { value: "25", label: "25: KEYCODE_VOLUME_DOWN" },
];

function cloneStep(step: FlowStep): FlowStep {
  return {
    ...step,
    params: { ...step.params },
    condition: step.condition ? { ...step.condition } : undefined,
    branches: step.branches?.map((branch) => ({
      ...branch,
      condition: branch.condition ? { ...branch.condition } : undefined,
      steps: branch.steps.map(cloneStep),
    })),
  };
}

function toStepTemplate(block: BlockCatalogItem): FlowStep {
  if (block.template) {
    return {
      type: block.template.type,
      name: block.template.name,
      params: { ...block.template.params },
      timeout_seconds: block.template.timeout_seconds,
    };
  }

  return {
    type: block.type,
    name: block.label,
    params: { ...(block.template_params ?? {}) },
  };
}

function fallbackCatalogBlocks(locale: Locale): BlockCatalogItem[] {
  return getBlockDefinitions(locale).map((block) => ({
    type: block.type,
    category: block.category,
    label: block.label,
    description: block.description,
    when_to_use: block.whenToUse,
    adb_command: block.adbCommand,
    is_condition: block.type === "if_condition" || block.type === "elif_condition" || block.type === "else_condition",
    template: {
      type: block.template.type,
      name: block.template.name,
      params: { ...block.template.params },
      timeout_seconds: block.template.timeout_seconds,
    },
    template_params: { ...block.template.params },
  }));
}

function isBlockCatalogItem(value: unknown): value is BlockCatalogItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<BlockCatalogItem>;
  return (
    typeof item.type === "string"
    && typeof item.category === "string"
    && typeof item.label === "string"
    && typeof item.description === "string"
    && typeof item.when_to_use === "string"
    && typeof item.adb_command === "string"
    && typeof item.is_condition === "boolean"
  );
}

function toBool(value: string | number | boolean | undefined, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function nextDuplicateName(baseName: string, steps: FlowStep[], excludeIndex?: number): string {
  const normalized = baseName.trim() || "Step";
  const existing = new Set(
    steps
      .map((item, idx) => ({ item, idx }))
      .filter(({ idx }) => idx !== excludeIndex)
      .map(({ item }) => item.name.trim())
      .filter(Boolean)
  );

  if (!existing.has(normalized)) {
    return normalized;
  }

  let suffix = 1;
  while (existing.has(`${normalized} ${suffix}`)) {
    suffix += 1;
  }
  return `${normalized} ${suffix}`;
}

function StepPickerPanel({
  text,
  pickerKeyword,
  setPickerKeyword,
  orderedCategories,
  groupedBlocks,
  addOrEditBlockStep,
}: {
  text: Record<string, string>;
  pickerKeyword: string;
  setPickerKeyword: (value: string) => void;
  orderedCategories: string[];
  groupedBlocks: Record<string, BlockCatalogItem[]>;
  addOrEditBlockStep: (targetType: StepType) => void;
}) {
  return (
    <div className="step-picker-panel" role="dialog" aria-label={text.blockSelector}>
      <input
        className="step-picker-search"
        value={pickerKeyword}
        onChange={(e) => setPickerKeyword(e.target.value)}
        placeholder={`🔍 ${text.searchPlaceholder}`}
      />

      <div className="step-picker-scroll">
        {orderedCategories.length === 0 && <p className="menu-empty">{text.noMatchingBlocks}</p>}

        {orderedCategories.map((category, categoryIndex) => (
          <section key={category} className="step-picker-group">
            {categoryIndex > 0 && <div className="step-picker-separator" />}
            <h3>{category}</h3>
            <div className="step-picker-items">
              {groupedBlocks[category].map((block) => (
                <div key={block.type} className="step-picker-item-row">
                  <button type="button" className="step-picker-item" onClick={() => addOrEditBlockStep(block.type)}>
                    <span className="step-picker-item-title">{block.label}</span>
                  </button>
                  <button
                    type="button"
                    className="step-picker-help"
                    title={`${block.description}\n${text.tooltipCommand}: ${block.adb_command}`}
                    aria-label={`${block.label} info`}
                  >
                    ?
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SimpleStepListEditor({
  locale,
  text,
  steps,
  setSteps,
  stepTemplates,
  availableBlocks,
  appPackages,
  appPackagesLoading,
  uploadApk,
  defaultStepTimeout = 30,
}: SimpleStepListEditorProps) {
  const [pickerKeyword, setPickerKeyword] = useState("");
  const [pickerContext, setPickerContext] = useState<PickerContext | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [pushPulseIndex, setPushPulseIndex] = useState<number | null>(null);
  const [appearOnceIndex, setAppearOnceIndex] = useState<number | null>(null);
  const [dragArmedIndex, setDragArmedIndex] = useState<number | null>(null);
  const [apkUploadProgress, setApkUploadProgress] = useState<Record<number, number>>({});
  const pickerRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (availableBlocks.length === 0) {
      setPickerKeyword("");
      setPickerContext(null);
    }
  }, [availableBlocks.length]);

  useEffect(() => {
    if (!pickerContext) {
      return;
    }

    const handleOutsidePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pickerRootRef.current && !pickerRootRef.current.contains(target)) {
        setPickerContext(null);
        setPickerKeyword("");
      }
    };

    window.addEventListener("mousedown", handleOutsidePointerDown);
    return () => window.removeEventListener("mousedown", handleOutsidePointerDown);
  }, [pickerContext]);

  useEffect(() => {
    if (appearOnceIndex == null) {
      return;
    }
    const timer = window.setTimeout(() => setAppearOnceIndex(null), 260);
    return () => window.clearTimeout(timer);
  }, [appearOnceIndex]);

  const blockLabelByType = useMemo(() => {
    const pairs = availableBlocks.map((block) => [block.type, block.label]);
    return Object.fromEntries(pairs) as Record<string, string>;
  }, [availableBlocks]);

  const updateStepAt = (index: number, updater: (step: FlowStep) => FlowStep) => {
    const next = [...steps];
    next[index] = updater(next[index]);
    setSteps(next);
  };

  const removeStepAt = (index: number) => {
    setSteps(steps.filter((_, idx) => idx !== index));
  };

  const reorderSteps = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) {
      return;
    }
    const next = [...steps];
    const [moving] = next.splice(from, 1);
    next.splice(to, 0, moving);
    setSteps(next);
    setPushPulseIndex(to);
  };

  const closePicker = () => {
    setPickerContext(null);
    setPickerKeyword("");
  };

  const addOrEditBlockStep = (targetType: StepType) => {
    const template = stepTemplates[targetType];
    if (!template || !pickerContext) {
      return;
    }

    if (pickerContext.mode === "edit" && pickerContext.index != null) {
      updateStepAt(pickerContext.index, () => {
        const draft = cloneStep(template);
        draft.name = nextDuplicateName(draft.name, steps, pickerContext.index ?? undefined);
        return draft;
      });
      closePicker();
      return;
    }

    const draft = cloneStep(template);
    draft.name = nextDuplicateName(draft.name, steps);

    if (pickerContext.mode === "add-after" && pickerContext.index != null) {
      const next = [...steps];
      next.splice(pickerContext.index + 1, 0, draft);
      setSteps(next);
      setAppearOnceIndex(pickerContext.index + 1);
      closePicker();
      return;
    }

    setSteps([...steps, draft]);
    setAppearOnceIndex(steps.length);
    closePicker();
  };

  const normalizedKeyword = pickerKeyword.trim().toLowerCase();
  const filteredBlocks = availableBlocks.filter((block) => {
    if (!normalizedKeyword) {
      return true;
    }
    const haystack = `${block.category} ${block.label} ${block.description} ${block.when_to_use} ${block.adb_command}`.toLowerCase();
    return haystack.includes(normalizedKeyword);
  });

  const groupedBlocks = filteredBlocks.reduce<Record<string, BlockCatalogItem[]>>((acc, block) => {
    if (!acc[block.category]) {
      acc[block.category] = [];
    }
    acc[block.category].push(block);
    return acc;
  }, {});
  const orderedCategories = Object.keys(groupedBlocks).sort((a, b) => a.localeCompare(b));

  return (
    <div className="step-list-editor" ref={pickerRootRef}>
      {steps.map((step, index) => {
        const errors = validateStep(step, locale);
        const typeLabel = blockLabelByType[step.type] ?? step.type;
        const showEditPanel = pickerContext?.mode === "edit" && pickerContext.index === index;
        const showInsertPanel = pickerContext?.mode === "add-after" && pickerContext.index === index;

        return (
          <div key={`simple-step-wrap-${index}`} className="step-card-wrap">
            <article
              className={`step-card ${appearOnceIndex === index ? "step-card-appear-once" : ""} ${draggingIndex === index ? "step-card-dragging" : ""} ${dropTargetIndex === index ? "step-card-drop-target" : ""} ${dropTargetIndex === index && draggingIndex !== index ? "step-card-insert-line" : ""} ${pushPulseIndex === index ? "step-card-pushed" : ""}`}
              draggable={dragArmedIndex === index}
              onDragStart={(event) => {
                if (dragArmedIndex !== index) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                setDraggingIndex(index);
                setDropTargetIndex(index);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (draggingIndex == null || draggingIndex === index) {
                  return;
                }
                setDropTargetIndex(index);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingIndex == null || dropTargetIndex == null) {
                  setDragArmedIndex(null);
                  return;
                }
                reorderSteps(draggingIndex, dropTargetIndex);
                setDraggingIndex(null);
                setDropTargetIndex(null);
                setDragArmedIndex(null);
                window.setTimeout(() => setPushPulseIndex(null), 220);
              }}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDropTargetIndex(null);
                setDragArmedIndex(null);
              }}
            >
              <div className="step-card-header">
                <div className="step-card-title">
                  <span
                    className="drag-handle"
                    title={text.dragHandleHint}
                    aria-label={text.dragHandleHint}
                    onMouseDown={() => setDragArmedIndex(index)}
                    onTouchStart={() => setDragArmedIndex(index)}
                  >
                    ⋮⋮
                  </span>
                  <strong>{typeLabel}</strong>
                </div>
                <div className="step-card-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setPickerContext({ mode: "edit", index });
                      setPickerKeyword("");
                    }}
                  >
                    {text.editBlock}
                  </button>
                  <button type="button" onClick={() => removeStepAt(index)}>{text.delete}</button>
                </div>
              </div>

              <label>
                <span>{text.stepNamePlaceholder}</span>
                <input
                  value={step.name}
                  onChange={(e) =>
                    updateStepAt(index, (prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <span>{`${text.stepTimeoutOverride} ${text.optionalLabel}`}</span>
                <input
                  type="number"
                  min={1}
                  max={600}
                  step={1}
                  value={step.timeout_seconds ?? ""}
                  placeholder={text.useGlobalTimeout}
                  onChange={(e) =>
                    updateStepAt(index, (prev) => {
                      const trimmed = e.target.value.trim();
                      if (!trimmed) {
                        const copy = { ...prev };
                        delete copy.timeout_seconds;
                        return copy;
                      }
                      return {
                        ...prev,
                        timeout_seconds: Math.round(Math.max(1, Math.min(600, Number(trimmed) || defaultStepTimeout))),
                      };
                    })
                  }
                />
                <span className="hint">{text.stepTimeoutHint}</span>
              </label>

              <div className="params-grid">
                {step.type === "keyevent" && (
                  <>
                    <label>
                      <span>{text.keyeventMode}</span>
                      <select
                        value={String(step.params.mode ?? "preset")}
                        onChange={(e) => {
                          const nextMode = e.target.value === "custom" ? "custom" : "preset";
                          updateStepAt(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              mode: nextMode,
                              keycode: nextMode === "custom"
                                ? String(prev.params.custom_keycode ?? "")
                                : String(prev.params.preset ?? "3"),
                            },
                          }));
                        }}
                      >
                        <option value="preset">{text.keyeventPreset}</option>
                        <option value="custom">{text.custom}</option>
                      </select>
                    </label>

                    {String(step.params.mode ?? "preset") !== "custom" && (
                      <label>
                        <span>{text.keyeventPreset}</span>
                        <select
                          value={String(step.params.preset ?? step.params.keycode ?? "3")}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateStepAt(index, (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                mode: "preset",
                                preset: value,
                                keycode: value,
                              },
                            }));
                          }}
                        >
                          {KEYEVENT_PRESETS.map((preset) => (
                            <option key={preset.value} value={preset.value}>{preset.label}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {String(step.params.mode ?? "preset") === "custom" && (
                      <label>
                        <span>{text.keyeventCustomCode}</span>
                        <input
                          value={String(step.params.custom_keycode ?? "")}
                          placeholder="例如: 26 或 KEYCODE_POWER"
                          onChange={(e) => {
                            const value = e.target.value;
                            updateStepAt(index, (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                mode: "custom",
                                custom_keycode: value,
                                keycode: value,
                              },
                            }));
                          }}
                        />
                      </label>
                    )}
                  </>
                )}

                {Object.entries(step.params).map(([key, value]) => {
                  if (step.type === "keyevent" && ["mode", "preset", "custom_keycode", "keycode"].includes(key)) {
                    return null;
                  }

                  if (APP_PACKAGE_TYPES.has(step.type) && key === "package") {
                    const currentPackage = String(step.params.package ?? "").trim();
                    const packageDetected = currentPackage !== "" && appPackages.includes(currentPackage);
                    const packageSelectValue = packageDetected ? currentPackage : "__custom__";
                    const showCustomInput = !packageDetected || appPackages.length === 0;

                    return (
                      <div key={key} className="package-picker-group">
                        <label>
                          <span>{text.packageDetectedList}</span>
                          <select
                            value={packageSelectValue}
                            onChange={(e) => {
                              const next = e.target.value;
                              updateStepAt(index, (prev) => ({
                                ...prev,
                                params: {
                                  ...prev.params,
                                  package: next === "__custom__" ? "" : next,
                                },
                              }));
                            }}
                          >
                            {appPackages.map((pkg) => (
                              <option key={pkg} value={pkg}>{pkg}</option>
                            ))}
                            <option value="__custom__">{text.custom}</option>
                          </select>
                        </label>

                        {showCustomInput && (
                          <label>
                            <span>{text.packageCustomInput}</span>
                            <input
                              value={currentPackage}
                              placeholder="com.example.app"
                              onChange={(e) => {
                                const next = e.target.value;
                                updateStepAt(index, (prev) => ({
                                  ...prev,
                                  params: {
                                    ...prev.params,
                                    package: next,
                                  },
                                }));
                              }}
                            />
                          </label>
                        )}

                        <span className="hint">
                          {appPackagesLoading
                            ? text.packageDetectLoading
                            : appPackages.length > 0
                              ? text.packageDetectReady
                              : text.packageDetectEmpty}
                        </span>
                      </div>
                    );
                  }

                  if (step.type === "install_apk" && key === "apk_path") {
                    return (
                      <label key={key}>
                        <span>{key}</span>
                        <div className="step-inline-actions">
                          <input
                            value={String(value)}
                            onChange={(e) => {
                              const next = e.target.value;
                              updateStepAt(index, (prev) => ({
                                ...prev,
                                params: {
                                  ...prev.params,
                                  apk_path: next,
                                },
                              }));
                            }}
                          />
                          <label className="apk-upload-btn">
                            {text.uploadApk}
                            <input
                              type="file"
                              accept=".apk,application/vnd.android.package-archive"
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (!file || !uploadApk) {
                                  return;
                                }
                                setApkUploadProgress((prev) => ({ ...prev, [index]: 0 }));
                                try {
                                  const hostPath = await uploadApk(file, (percent) => {
                                    setApkUploadProgress((prev) => ({ ...prev, [index]: percent }));
                                  });
                                  updateStepAt(index, (prev) => ({
                                    ...prev,
                                    params: {
                                      ...prev.params,
                                      apk_path: hostPath,
                                    },
                                  }));
                                } finally {
                                  setTimeout(() => {
                                    setApkUploadProgress((prev) => {
                                      const next = { ...prev };
                                      delete next[index];
                                      return next;
                                    });
                                  }, 400);
                                }
                              }}
                            />
                          </label>
                        </div>
                        {typeof apkUploadProgress[index] === "number" && (
                          <div className="upload-progress-wrap" role="status" aria-live="polite">
                            <div className="upload-progress-track">
                              <div className="upload-progress-fill" style={{ width: `${apkUploadProgress[index]}%` }} />
                            </div>
                            <span className="upload-progress-text">{Math.round(apkUploadProgress[index])}%</span>
                          </div>
                        )}
                      </label>
                    );
                  }

                  if (step.type === "screenshot" && key === "local_pull_dir") {
                    const currentPath = String(value ?? "");
                    return (
                      <label key={key}>
                        <span>{key}</span>
                        <div className="step-inline-actions">
                          <input
                            value={currentPath}
                            onChange={(e) => {
                              const next = e.target.value;
                              updateStepAt(index, (prev) => ({
                                ...prev,
                                params: {
                                  ...prev.params,
                                  local_pull_dir: next,
                                },
                              }));
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const valueFromPrompt = window.prompt(text.selectPathPrompt, currentPath);
                              if (valueFromPrompt == null) {
                                return;
                              }
                              updateStepAt(index, (prev) => ({
                                ...prev,
                                params: {
                                  ...prev.params,
                                  local_pull_dir: valueFromPrompt.trim(),
                                },
                              }));
                            }}
                          >
                            {text.selectPathButton}
                          </button>
                        </div>
                      </label>
                    );
                  }

                  if (step.type === "get_props" && key === "property") {
                    const propValue = String(value ?? "").trim();
                    const isPreset = ["ro.build.version.release", "ro.product.model", "ro.product.device", "ro.serialno"].includes(propValue);
                    const quickMode = propValue === "" ? "__all__" : isPreset ? propValue : "__custom__";
                    return (
                      <div key={key} className="package-picker-group">
                        <label>
                          <span>{text.getpropQuickSelect}</span>
                          <select
                            value={quickMode}
                            onChange={(e) => {
                              const selected = e.target.value;
                              updateStepAt(index, (prev) => ({
                                ...prev,
                                params: {
                                  ...prev.params,
                                  property: selected === "__all__" ? "" : selected === "__custom__" ? "" : selected,
                                },
                              }));
                            }}
                          >
                            <option value="__all__">{text.getpropAll}</option>
                            <option value="ro.build.version.release">ro.build.version.release</option>
                            <option value="ro.product.model">ro.product.model</option>
                            <option value="ro.product.device">ro.product.device</option>
                            <option value="ro.serialno">ro.serialno</option>
                            <option value="__custom__">{text.custom}</option>
                          </select>
                        </label>
                        {quickMode === "__custom__" && (
                          <label>
                            <span>{text.getpropCustom}</span>
                            <input
                              value={String(value)}
                              onChange={(e) =>
                                updateStepAt(index, (prev) => ({
                                  ...prev,
                                  params: {
                                    ...prev.params,
                                    property: e.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        )}
                      </div>
                    );
                  }

                  if (typeof value === "boolean" || BOOL_PARAM_KEYS.has(key)) {
                    return (
                      <label key={key} className="checkbox">
                        <input
                          type="checkbox"
                          checked={toBool(value)}
                          onChange={(e) => {
                            updateStepAt(index, (prev) => ({
                              ...prev,
                              params: {
                                ...prev.params,
                                [key]: e.target.checked,
                              },
                            }));
                          }}
                        />
                        <span>{key}</span>
                      </label>
                    );
                  }

                  return (
                    <label key={key}>
                      <span>{key}</span>
                      <input
                        value={String(value)}
                        onChange={(e) =>
                          updateStepAt(index, (prev) => ({
                            ...prev,
                            params: {
                              ...prev.params,
                              [key]: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  );
                })}
              </div>

              {errors.length > 0 && (
                <ul className="validation-errors">
                  {errors.map((err, errIndex) => (
                    <li key={`${index}-${errIndex}`}>{err}</li>
                  ))}
                </ul>
              )}

              {showEditPanel && (
                <StepPickerPanel
                  text={text}
                  pickerKeyword={pickerKeyword}
                  setPickerKeyword={setPickerKeyword}
                  orderedCategories={orderedCategories}
                  groupedBlocks={groupedBlocks}
                  addOrEditBlockStep={addOrEditBlockStep}
                />
              )}
            </article>

            <div className="step-inline-add">
              <button
                type="button"
                onClick={() => {
                  setPickerContext({ mode: "add-after", index });
                  setPickerKeyword("");
                }}
                disabled={availableBlocks.length === 0}
              >
                {text.addAfterStep}
              </button>
            </div>

            {showInsertPanel && (
              <div className="step-inline-picker">
                <StepPickerPanel
                  text={text}
                  pickerKeyword={pickerKeyword}
                  setPickerKeyword={setPickerKeyword}
                  orderedCategories={orderedCategories}
                  groupedBlocks={groupedBlocks}
                  addOrEditBlockStep={addOrEditBlockStep}
                />
              </div>
            )}
          </div>
        );
      })}

      {steps.length === 0 && (
        <div className="step-picker">
          <button
            type="button"
            onClick={() => {
              if (pickerContext?.mode === "add-tail") {
                closePicker();
              } else {
                setPickerContext({ mode: "add-tail", index: null });
                setPickerKeyword("");
              }
            }}
            disabled={availableBlocks.length === 0}
          >
            {text.addBlock}
          </button>

          {pickerContext?.mode === "add-tail" && (
            <StepPickerPanel
              text={text}
              pickerKeyword={pickerKeyword}
              setPickerKeyword={setPickerKeyword}
              orderedCategories={orderedCategories}
              groupedBlocks={groupedBlocks}
              addOrEditBlockStep={addOrEditBlockStep}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function StepBuilder({
  locale,
  steps,
  setSteps,
  loadBlocks,
  loadThirdPartyPackages,
  uploadApk,
  selectedDevice,
  defaultStepTimeout = 30,
}: Props) {
  const text = uiText[locale] as Record<string, string>;
  const [catalogBlocks, setCatalogBlocks] = useState<BlockCatalogItem[]>([]);
  const [catalogState, setCatalogState] = useState<CatalogState>("loading");
  const [catalogMessage, setCatalogMessage] = useState<string>(text.blockCatalogLoading);
  const [appPackages, setAppPackages] = useState<string[]>([]);
  const [appPackagesLoading, setAppPackagesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const applyFallback = (reason: string) => {
      const fallback = fallbackCatalogBlocks(locale);
      if (cancelled) {
        return;
      }

      if (fallback.length > 0) {
        setCatalogBlocks(fallback);
        setCatalogState("partial-success");
        setCatalogMessage(`${text.blockCatalogFallback} (${reason})`);
      } else {
        setCatalogBlocks([]);
        setCatalogState("error");
        setCatalogMessage(`${text.blockCatalogError} (${reason})`);
      }
    };

    const fetchBlocks = async () => {
      setCatalogState("loading");
      setCatalogMessage(text.blockCatalogLoading);

      if (!loadBlocks) {
        const fallback = fallbackCatalogBlocks(locale);
        if (cancelled) {
          return;
        }

        setCatalogBlocks(fallback);
        setCatalogState(fallback.length > 0 ? "ready" : "empty");
        setCatalogMessage(fallback.length > 0 ? text.blockCatalogLoading : text.blockCatalogEmpty);
        return;
      }

      try {
        const remoteBlocks = await loadBlocks(locale);

        if (!Array.isArray(remoteBlocks)) {
          throw new Error(text.blockCatalogContractMismatch);
        }

        const validBlocks = remoteBlocks.filter(isBlockCatalogItem);
        if (cancelled) {
          return;
        }

        if (validBlocks.length === 0) {
          setCatalogBlocks([]);
          setCatalogState("empty");
          setCatalogMessage(text.blockCatalogEmpty);
          return;
        }

        setCatalogBlocks(validBlocks);

        if (validBlocks.length < remoteBlocks.length) {
          setCatalogState("partial-success");
          setCatalogMessage(text.blockCatalogContractMismatch);
          return;
        }

        setCatalogState("ready");
        setCatalogMessage("");
      } catch (error) {
        applyFallback(String(error));
      }
    };

    fetchBlocks();
    return () => {
      cancelled = true;
    };
  }, [locale, loadBlocks, text.blockCatalogContractMismatch, text.blockCatalogError, text.blockCatalogFallback, text.blockCatalogLoading, text.blockCatalogEmpty]);

  useEffect(() => {
    let cancelled = false;

    const fetchPackages = async () => {
      if (!selectedDevice || !loadThirdPartyPackages) {
        setAppPackages([]);
        setAppPackagesLoading(false);
        return;
      }

      setAppPackagesLoading(true);
      try {
        const payload = await loadThirdPartyPackages(selectedDevice);
        if (cancelled) {
          return;
        }
        setAppPackages(payload.filter((item) => item.trim() !== ""));
      } catch {
        if (!cancelled) {
          setAppPackages([]);
        }
      } finally {
        if (!cancelled) {
          setAppPackagesLoading(false);
        }
      }
    };

    fetchPackages();
    return () => {
      cancelled = true;
    };
  }, [selectedDevice, loadThirdPartyPackages]);

  const stepTemplates = useMemo(() => {
    const map = {} as Record<StepType, FlowStep>;
    for (const block of catalogBlocks) {
      map[block.type] = toStepTemplate(block);
    }
    return map;
  }, [catalogBlocks]);

  return (
    <section>
      <h2>{text.flowBlocks}</h2>
      <p className="hint">{text.conditionBuilderHint}</p>

      {catalogState !== "ready" && (
        <div className={`catalog-state catalog-state-${catalogState}`} role="status" aria-live="polite">
          {catalogState === "loading" && text.blockCatalogLoading}
          {catalogState === "empty" && text.blockCatalogEmpty}
          {catalogState === "error" && catalogMessage}
          {catalogState === "partial-success" && `${text.blockCatalogPartialSuccess} ${catalogMessage}`}
        </div>
      )}

      <SimpleStepListEditor
        locale={locale}
        text={text}
        steps={steps}
        setSteps={setSteps}
        stepTemplates={stepTemplates}
        availableBlocks={catalogBlocks}
        appPackages={appPackages}
        appPackagesLoading={appPackagesLoading}
        uploadApk={uploadApk}
        defaultStepTimeout={defaultStepTimeout}
      />
    </section>
  );
}
