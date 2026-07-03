# Assistant Rollout

本文件是 [[assistant-contract]] 拆分后的子文档。

相关子文档：

- [[assistant-capabilities]]
- [[assistant-safety]]

## Runtime Truth

- orchestration foundation is LangGraph
- streaming transport is SSE
- markdown output is expected
- retrieval is source-split across Chinese leaflets, filtered medical QA, and entity-scoped DrugBank
  passages
- assistant retrieval loops are bounded; runtime may decide to call zero, one, or multiple retrieval
  tools, but only inside explicit loop and tool-count caps
- persisted assistant conversations are live
- cross-conversation memory is optional and controlled by `assistantMemoryEnabled`
