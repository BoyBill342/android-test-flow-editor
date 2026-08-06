# Architecture (MVP) / 架構說明（MVP）

This document provides a high-level architecture overview for the MVP version.
本文件提供 MVP 版本的高層架構總覽。

## Frontend

The frontend is a React + TypeScript application that provides:
前端採用 React + TypeScript，以下為主要能力（technical details keep in English）：

- Device selection
- Block step list editing
- Flow execution trigger
- Result and logs panel

This first version uses sequence-based blocks and is prepared for graph-based expansion.

## Backend

The backend is a FastAPI service with three core modules:
後端採用 FastAPI，以下為核心模組（technical details keep in English）：

- `adb_service`: device listing and command execution
- `command_validator`: restricted mode checks for custom commands
- `executor`: step-to-command mapping and flow orchestration

## Execution model

The following sequence describes how a flow is processed end-to-end.
以下流程描述一次 Flow 從提交到結果返回的完整處理順序。

1. User submits flow JSON with selected device serial.
2. Backend validates each step and builds ADB command arguments.
3. Steps are executed sequentially.
4. Backend returns per-step status and aggregated result.

## Next iteration targets

Planned directions for the next iteration are listed below.
下一個迭代版本的規劃方向如下。

- Add graph edges and conditional branching
- Add WebSocket streaming logs
- Add persistent storage for flow versions
