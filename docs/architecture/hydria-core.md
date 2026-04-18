# Hydria Core

Hydria ne migre pas vers un framework multi-agent unique.  
Le repo se dote d’un noyau d’interfaces internes, branché d’abord sur `student` et `research`.

## Inspirations traduites

- AutoGen
  - `message`, `handoff`, `workflow`
- CrewAI
  - `task`, `owner`, `workflow scope`
- Perplexica / Vane
  - `ground_claims`, `research_planner`, `research_retriever`, `research_verifier`
- MemGPT / Letta
  - `memory snapshot` avec couches `core`, `episodic`, `semantic`, `archival`
- LlamaIndex
  - prochaine étape potentielle: loaders / chunking / indexing sur la couche documentaire
- GraphRAG
  - repoussé: pas encore nécessaire tant que retrieval et extraction restent le bottleneck

## Contrats introduits

Fichier: [apps/server/src/types/core.ts](/F:/hydria-arena/apps/server/src/types/core.ts)

- `HydriaWorkflowRun`
  - trace structurée d’un run
- `HydriaWorkflowMessage`
  - message typé produit par un rôle
- `HydriaWorkflowHandoff`
  - transfert explicite entre rôles
- `HydriaWorkflowTask`
  - unité de travail simple avec owner et status
- `HydriaMemorySnapshot`
  - vue compacte de la mémoire injectée au run

## Intégration actuelle

Le flux `student` expose déjà:

- `preview.memory`
- `preview.workflow`
- `session.memory`
- `session.workflow`

Le flux `arena` expose maintenant aussi:

- `round.memory`
- `round.workflow`

Les adapters sont ici:

- [hydriaCoreMemoryService.ts](/F:/hydria-arena/apps/server/src/services/core/hydriaCoreMemoryService.ts)
- [hydriaCoreWorkflowService.ts](/F:/hydria-arena/apps/server/src/services/core/hydriaCoreWorkflowService.ts)

Ils consomment les données réelles de:

- `KnowledgeInjectionService`
- `StudentService`
- `ResearchToolLog`

## Migration incrémentale

1. Stabiliser `student`, `arena` et `research` sur ces contrats.
2. Exposer `memory` et `workflow` dans l’UI avec une lecture simple, pas verbeuse.
3. Ajouter une couche documentaire plus formelle si le besoin de loaders/index apparaît.
4. Introduire un graphe d’entités seulement si les evals montrent un vrai manque de linking transverse.
