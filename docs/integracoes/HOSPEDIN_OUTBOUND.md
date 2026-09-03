# Hospedin Outbound — Documentação Oficial (Jango → Hospedin)

**Versão:** consolidada em 2026-09-03  
**Escopo deste documento:** integração **outbound** homologada (`HOSPEDIN_OUTBOUND`).  
**Inbound:** ver [`docs/integrations/hospedin.md`](../../../docs/integrations/hospedin.md) — **não alterar** ao mexer no outbound.

> **Regra de ouro:** antes de qualquer alteração no outbound, leia este documento e preserve comportamentos homologados.

---

## Índice

1. [Objetivo e escopo](#1-objetivo-e-escopo)
2. [Arquitetura](#2-arquitetura)
3. [Fora do escopo](#3-fora-do-escopo)
4. [CREATE](#4-create)
5. [UPDATE](#5-update)
6. [CANCEL](#6-cancel)
7. [Race CREATE × CANCEL](#7-race-create--cancel)
8. [Fila `hospedin_outbound_sync_state`](#8-fila-hospedin_outbound_sync_state)
9. [Dispatcher](#9-dispatcher)
10. [Watchdog](#10-watchdog)
11. [Concorrência](#11-concorrência)
12. [Scheduler](#12-scheduler)
13. [Inbound (não alterar)](#13-inbound-não-alterar)
14. [Origem (`origemReserva`)](#14-origem-origemreserva)
15. [Banco e migrations](#15-banco-e-migrations)
16. [Configuração](#16-configuração)
17. [Testes automatizados](#17-testes-automatizados)
18. [Homologações reais](#18-homologações-reais)
19. [Estado atual conhecido](#19-estado-atual-conhecido)
20. [Regras obrigatórias para futuras alterações](#20-regras-obrigatórias-para-futuras-alterações)
21. [Troubleshooting (estados)](#21-troubleshooting-estados)
22. [Guia para futuras alterações](#22-guia-para-futuras-alterações)

---

## Auditoria da documentação existente (pré-consolidação)

| Documento | Cobre outbound? | Lacuna principal |
|-----------|-----------------|------------------|
| `docs/integrations/hospedin.md` | Parcial (§11 resumido) | Cabeçalho ainda diz “fora de escopo sync Jango→Hospedin”; sem dispatcher/watchdog/homolog |
| `docs/integrations/scheduler-multi-provider.md` | Não | Só inbound genérico; sem `HOSPEDIN_OUTBOUND` |
| `docs/integrations/hospedin-homologacao-sync-rfc002.md` | Não | Inbound apenas |
| `docs/integrations/hospedin-homologacao-create.md` | Não | Obsoleto (diz UPDATE/CANCEL não implementados) |
| `docs/integrations/hospedin-rfc002-fase2-decisoes.md` | Não | Decisões inbound |
| Scripts `ticket-node/scripts/_homolog-etapa*.js` | Sim (procedimentos) | Sem doc narrativa central |

**Este arquivo** (`ticket-node/docs/integracoes/HOSPEDIN_OUTBOUND.md`) passa a ser a referência oficial do outbound.

---

## 1. Objetivo e escopo

### Objetivo

Replicar no Hospedin PMS, de forma **assíncrona e idempotente**, o estado **operacional** de reservas Jango de pousada que **não** vieram do Hospedin:

- **CREATE** — primeira publicação da reserva no Hospedin após confirmação elegível.
- **UPDATE** — alterações operacionais (datas, suíte, ocupação adultos/crianças, observações).
- **CANCEL** — cancelamento no Hospedin quando a reserva Jango foi cancelada e já existe vínculo remoto.

### Escopo incluído

- Fila por reserva: `hospedin_outbound_sync_state`
- Provider scheduler: `HOSPEDIN_OUTBOUND`
- Dispatcher orientado a `has_pending` + watchdog de segurança
- Mapeamento suíte Jango ↔ `place_id` Hospedin (`hospedin_place_suite_map`)
- Guest mínimo (`POST /guests` com `name`)
- Hash/diff/PATCH mínimo para UPDATE
- Classificação de erros HTTP e retry com backoff
- Proteção CREATE × CANCEL (race)

### Escopo excluído

Ver [§3](#3-fora-do-escopo).

---

## 2. Arquitetura

### 2.1 Jango → Hospedin (outbound — este documento)

```
Alteração Jango (markDirty / markOutboundCancelled)
        ↓
HospedinOutboundEnqueueService
  → avalia origem + pré-condições
  → grava/atualiza hospedin_outbound_sync_state
  → has_pending = 1 (integration_provider_state)
  → notifyOutboundPendingIfClaimable → Dispatcher (signal)
        ↓
HospedinOutboundDispatcher.drainClaimableQueue
  → runProviderCycle('HOSPEDIN_OUTBOUND')
        ↓
HospedinOutboundRunner.runCycle
  → recoverStaleProcessing
  → listDue(syncLimit) → tryClaim → PROCESSING
  → CREATE | UPDATE | CANCEL (services)
  → markSynced | WAIT_RETRY | FAILED | ABORTED | releaseToPending
        ↓
Hospedin API (POST /reservations, PATCH /reservations/:id)
```

**Código raiz:** `ticket-node/src/integrations/hospedin/outbound/`

### 2.2 Hospedin → Jango (inbound — separado)

```
Hospedin API → Import → Staging → Validation → IntegrationSyncState
  → Orchestrator → Runner/Executor → Jango
```

- Estado oficial inbound: `integration_sync_state` (não confundir com outbound).
- Documentação: [`docs/integrations/hospedin.md`](../../../docs/integrations/hospedin.md)
- Pipeline: `ticket-node/src/integrations/hospedin/pipeline/index.ts`

**Os dois fluxos coexistem mas não compartilham fila nem estado de sync.**

---

## 3. Fora do escopo

Explicitamente **proibido** no outbound homologado:

| Área | Detalhe |
|------|---------|
| Financeiro Jango → Hospedin | Sem `daily_cents` reais de negócio; payload usa valores operacionais mínimos |
| Financeiro Hospedin → Jango | Inbound tem regra própria; outbound não toca |
| Pagamentos | Sem webhooks de pagamento, sem confirmação financeira remota |
| `reservation_transactions` | Homolog scripts bloqueiam HTTP a este path |
| `sales` | Idem |
| `rate_reservations` | Idem |
| Sincronização financeira OTA | `has_payment_coming_from_ota: false` fixo no CREATE |
| Status operacional Jango no UPDATE hash | Check-in/check-out Jango não geram diff outbound |
| Lista de hóspedes / `guest_id` no UPDATE | Fora do hash; guest só no CREATE |
| Reservas `origemReserva === 'HOSPEDIN'` | Nunca entram na fila outbound |
| Eventos que não são `Pousada` | Ignorados no enqueue |

Scripts de homologação auditam HTTP e falham se chamar endpoints financeiros (`FORBIDDEN_HTTP` em `_homolog-final-dispatch-127.js`, etapas 7.x).

---

## 4. CREATE

### 4.1 Gatilhos (`markDirty`)

Pontos de produção que chamam `hospedinOutboundEnqueueService.markDirty`:

| Origem | Arquivo | Momento |
|--------|---------|---------|
| Confirmação de pagamento / hospedagem | `reservaSuiteService.ts` | `confirmarHospedagem` |
| Check-out | `reservaSuiteService.ts` | `checkoutHospedagem` |
| Alterar observações (admin) | `hospedagemAdminService.ts` | `atualizarObservacoesReservaAdmin` |
| Troca de suíte (admin) | `hospedagemAdminService.ts` | `trocarSuiteReservaAdmin` |
| Alterar período (admin) | `hospedagemAdminService.ts` | `alterarPeriodoReservaAdmin` |

**Cancelamento** usa `markOutboundCancelled` (não `markDirty`):

| Origem | Arquivo |
|--------|---------|
| Cancelar reserva | `reservaSuiteService.ts` (`cancelarReservaHospedagem`, idempotente) |
| Cancelamento admin | `hospedagemCancelamentoAdminService.ts` |

### 4.2 Enqueue vs execução

- **Enqueue** (`markDirty`): pode ocorrer em qualquer status Jango (ex.: `AguardandoPagamento`).
- **POST efetivo** (`HospedinOutboundCreateService`): valida status elegível antes do HTTP.

Status no runner (`HospedinOutboundPayloadBuilder.ts`):

| Conjunto | Status Jango | Comportamento |
|----------|--------------|---------------|
| Elegível | `Confirmada`, `Hospedada` | Pode POST |
| Adiado | `AguardandoPagamento` | `releaseToPending`, outcome `deferred` |
| Terminal | `Cancelada`, `Expirada`, `CheckOutRealizado` | `FAILED` permanente |
| Cancelada no CREATE | `Cancelada` | `markAborted`, `CREATE_ABORTED` |

### 4.3 Estados na fila (CREATE)

| Condição | `desired_action` | `outbound_status` |
|----------|------------------|-------------------|
| Nunca enviado (sem `idExterno` e sem `hospedin_reservation_id`) | `CREATE` | `PENDING_CREATE` |
| Já enviado | `UPDATE` | `PENDING_UPDATE` |
| Pré-condição falha | (mantém ação) | `BLOCKED` |
| Linha em `PROCESSING` | — | mantém `PROCESSING` |
| Hash igual em `SYNCED` | — | no-op (não re-dirty) |

### 4.4 Pré-condições (→ `BLOCKED`, não descarta fila)

Códigos (`HospedinOutboundPreconditionCode`):

- `SUITE_LINE_MISSING`
- `GUEST_NAME_MISSING` — ao menos um hóspede com nome na 1ª linha de suíte
- `SUITE_UNMAPPED` — mapa `hospedin_place_suite_map` ativo + `LINKED`

Reavaliadas a cada `markDirty`; recuperação automática quando resolvido.

### 4.5 Payload POST (`buildOutboundReservationPayload`)

Campos enviados (`HospedinOutboundPayloadBuilder.ts`):

- `place_id`, `place_type_id`
- `status: 'reservation'`
- `check_in`, `check_out` — formato `yyyy-MM-dd'T'HH:mm` em `TZ_HOSPEDAGEM`
- `adults` (mín. 1), `children` (mín. 0)
- `exempt: 0`
- `note` — observações com sufixo Jango quando aplicável
- `guest_id`
- `daily_cents`, `total_daily_cents` — operacionais (não financeiro de negócio)
- `has_payment_coming_from_ota: false`, `has_breakfast: false`, `sale_channel_id: null`

### 4.6 Guest

1. Primeiro hóspede com nome na 1ª `ReservaSuite`.
2. `HospedinOutboundGuestService.resolveOrCreateGuestId`:
   - Reusa `hospedin_guest_id` da fila se válido.
   - Senão `POST /api/v2/{accountId}/guests` com `{ name }`.
3. Persiste `hospedin_guest_id` **antes** do POST da reserva.

### 4.7 Accommodation / place mapping

- `hospedinPlaceSuiteMapService.findByEventoSuiteId(idEventoSuite)`
- Exige mapa **ativo** e `PlaceSuiteMappingStatus.LINKED`
- `place_id` do mapa; `place_type_id` via catálogo Hospedin Place
- Erros: `SUITE_UNMAPPED`, `PLACE_INVALID`, `PLACE_TYPE_MISSING`

### 4.8 Idempotência

`tryIdempotentSync` (`HospedinOutboundCreateService`):

- Se já existe `ReservaHospedagem.idExterno` ou `hospedin_reservation_id` → `markSynced`, outcome `idempotent`, **sem POST**.
- Backfill de `idExterno` na reserva se só a fila tiver o ID.

### 4.9 Persistência dos IDs (ordem pós-POST)

1. `persistHospedinIds` na fila (`hospedin_reservation_id`, `hospedin_guest_id`)
2. `ReservaHospedagem.update({ idExterno, codigoExterno })`
3. `finalizeCreateAfterPost` (ver §7)

### 4.10 Retries

- `maxRetries` default **5** — env `HOSPEDIN_OUTBOUND_SYNC_MAX_RETRIES`
- Backoff base **30s** — env `HOSPEDIN_OUTBOUND_SYNC_BACKOFF_BASE_SECONDS`
- Exponencial com cap 3600s (`integrations/core/types.ts`)
- Excede max → `FAILED`

### 4.11 Erros HTTP (`classifyOutboundHttpError`)

| HTTP | Retry? | `error_code` típico |
|------|--------|---------------------|
| 401/403 | Sim | `AUTH_ERROR` |
| 429 | Sim | `RATE_LIMITED` |
| 5xx | Sim | `HTTP_5XX` |
| Rede/0 | Sim | `NETWORK_ERROR` |
| 422 | Não | `VALIDATION_ERROR` |
| 404 | Não | `NOT_FOUND` |
| 409 | Não | `HTTP_409` |

### 4.12 `RECONCILE_REQUIRED`

Quando POST Hospedin **sucede** mas persistência local falha:

- `outbound_status = FAILED`
- `error_code = 'RECONCILE_REQUIRED'`
- Requer intervenção manual: alinhar IDs locais com remoto.

### 4.13 Outcomes CREATE

`created | idempotent | deferred | blocked | failed | retry | aborted`

---

## 5. UPDATE

### 5.1 Campos sincronizados (hash)

Incluídos em `buildSnapshotFromReserva` / hash (`HospedinOutboundSnapshot.ts`):

- `checkin`, `checkout`
- `idEventoSuite`
- `observacoes` (operador + importada, conforme builder)
- `adultos`, `criancas`

**Fora do hash (não disparam UPDATE):**

- Status operacional Jango (Confirmada/Hospedada/Check-in)
- Hóspedes / `guest_id`
- Qualquer campo financeiro

### 5.2 Hash, snapshot, diff

| Artefato | Coluna / função |
|----------|-----------------|
| Snapshot atual | `buildSnapshotFromReserva` |
| Hash pendente | `pending_payload_hash` |
| Hash sincronizado | `payload_hash` |
| Baseline JSON | `synced_hash_input_json` |
| Diff | `diffOutboundHashInputs` → `buildOutboundUpdatePatch` |

Algoritmo: SHA-256 sobre JSON canônico do hash input.

### 5.3 PATCH mínimo

Somente campos alterados (`HospedinOutboundReservationPatch`):

- `check_in`, `check_out`
- `place_id`, `place_type_id` (troca de suíte — **ambos obrigatórios juntos**)
- `adults`, `children`
- `note`

Campos alterados mas não patcháveis → `UNSUPPORTED_CHANGE` → `FAILED`.

### 5.4 Política 409

`OUTBOUND_UPDATE_409_POLICY`: HTTP **409** → `FAILED` permanente (`HTTP_409`), **sem retry**.

### 5.5 Idempotência

- `payload_hash === pending_payload_hash` ou hash atual === `payload_hash` → `markSynced`, outcome `idempotent`
- PATCH vazio (sem diff) → idempotent, sem HTTP

### 5.6 Stale após PATCH

Se fila mudou durante PATCH (`latestHash !== sentHash`) → `releaseToPending(UPDATE)`, outcome `stale` (reprocessa).

### 5.7 404

`RESERVATION_NOT_FOUND` — permanente, sem retry, **sem recriar** reserva.

### 5.8 `RECONCILE_REQUIRED` (UPDATE)

- PATCH ok, reload da fila falha
- PATCH ok, `markSynced` falha

### 5.9 Retries

Mesma política do CREATE (max 5, backoff 30s base).

### 5.10 Outcomes UPDATE

`updated | idempotent | deferred | blocked | failed | retry | stale`

---

## 6. CANCEL

### 6.1 Entrada (`markOutboundCancelled`)

Pré-requisitos:

1. `isOriginEligibleForOutbound` (não HOSPEDIN, evento Pousada)
2. `ReservaHospedagem.status === Cancelada`

| Vínculo Hospedin | Resultado |
|------------------|-----------|
| **Sem** `idExterno` / `hospedin_reservation_id` | `ABORTED`, `error_code='CREATE_ABORTED'` — **nunca POST** |
| **Com** vínculo | `PENDING_CANCEL`, `desired_action=CANCEL` |

### 6.2 Runner

Executa cancel se `desired_action === CANCEL` **ou** `outbound_status === PENDING_CANCEL`.

### 6.3 Fluxo HTTP (`HospedinOutboundCancelService`)

1. Jango não `Cancelada` → `releaseToPending(CANCEL)`, outcome `aborted`, `JANGO_NOT_CANCELLED`
2. Sem ID remoto → `markAborted`, `HOSPEDIN_ID_MISSING`
3. `GET` reserva remota
4. Já cancelada (`isHospedinCancelledStatus`) → idempotent
5. `PATCH { status: 'canceled' }` via `buildOutboundCancelPatch`
6. Status pós-PATCH inesperado → `FAILED`, `CANCEL_NOT_CONFIRMED`

Status remotos aceitos como cancelado: `canceled`, `cancelled`, `no_show`, `noshow`, `void`, `deleted`.

### 6.4 404

`RESERVATION_NOT_FOUND` — não retryável.

### 6.5 `ABORTED` vs reenfileiramento

- Enqueue sem vínculo → `ABORTED` definitivo
- Jango deixou de estar cancelada após tentativa → reenfileira `markPendingCancel` (não `markAborted` no runner)

### 6.6 `markDirty` e estados terminais

`markDirty` **ignora** reservas `Cancelada` e filas `ABORTED` / `PENDING_CANCEL` (não sobrescreve intenção de cancel).

---

## 7. Race CREATE × CANCEL

### 7.1 Problema original

Reserva cancelada no Jango **durante** ou **logo após** POST CREATE no Hospedin podia marcar `SYNCED` indevidamente, perdendo a intenção de cancel.

### 7.2 Proteções implementadas

1. `markOutboundCancelled` durante POST altera `desired_action=CANCEL` / `PENDING_CANCEL`
2. `finalizeCreateAfterPost` recarrega Jango + fila (fresh reload)
3. `resolveCreateFinalizeDecision` (`hospedinOutboundCreateFinalize.ts`):
   - `jangoStatus === Cancelada` → `pending_cancel`
   - `desiredAction === CANCEL` → `pending_cancel`
   - `outboundStatus === PENDING_CANCEL` → `pending_cancel`
4. **CAS atômico** em `finalizeCreateAfterPost`: UPDATE só se `outbound_status=PROCESSING` AND `desired_action != CANCEL`
5. CAS falha → `markPendingCancel` preservando IDs já persistidos
6. Fresh reload antes de idempotency no CREATE

### 7.3 Comportamento esperado

| Cenário | Resultado |
|---------|-----------|
| Cancel antes do POST | `ABORTED` / defer; sem POST |
| Cancel durante POST | `PENDING_CANCEL` após finalize; CANCEL subsequente |
| Cancel após POST, antes finalize | `pending_cancel`; não `SYNCED` indevido |
| CREATE normal sem cancel | `SYNCED` com IDs persistidos |

**Testes:** `HospedinOutboundCreateRace.test.ts` (cenários 1–8).

---

## 8. Fila `hospedin_outbound_sync_state`

### 8.1 Estados (`HospedinOutboundStatus`)

| Status | Claimable? | Significado |
|--------|------------|-------------|
| `PENDING_CREATE` | Sim | Aguardando POST |
| `PENDING_UPDATE` | Sim | Aguardando PATCH |
| `PENDING_CANCEL` | Sim | Aguardando cancel PATCH |
| `WAIT_RETRY` | Sim | Falha retryável; aguarda `next_retry_at` |
| `PROCESSING` | Não | Claim ativo |
| `SYNCED` | Não | Alinhado com último hash/ação |
| `FAILED` | Não | Erro permanente ou esgotou retries |
| `BLOCKED` | Não | Pré-condição (mapeamento, hóspede, suíte) |
| `ABORTED` | Não | Cancel sem vínculo / CREATE abortado |

Fonte claimable: `OUTBOUND_CLAIMABLE_STATUSES` em `hospedinOutboundClaimable.ts`.

### 8.2 `desired_action`

| Valor | Status pendente resolvido |
|-------|---------------------------|
| `CREATE` | `PENDING_CREATE` |
| `UPDATE` | `PENDING_UPDATE` |
| `CANCEL` | `PENDING_CANCEL` |

### 8.3 Hashes e IDs

| Coluna | Uso |
|--------|-----|
| `pending_payload_hash` | Hash do snapshot atual no enqueue |
| `payload_hash` | Último hash aplicado com sucesso |
| `synced_hash_input_json` | Baseline JSON para diff UPDATE |
| `hospedin_reservation_id` | ID reserva Hospedin |
| `hospedin_guest_id` | ID guest Hospedin |
| `retry_count`, `next_retry_at` | Política de retry |
| `processing_started_at`, `processing_correlation_id` | Claim / stale recovery |
| `dirty_at` | Ordenação FIFO na fila |
| `outbound_version` | Versão incremental (controle interno) |

### 8.4 Claim / retry

- `listDue(limit)`: status claimable + `next_retry_at <= now`, ordem `dirty_at ASC`
- `tryClaim`: UPDATE condicional → `PROCESSING`; sucesso se `affectedRows === 1`
- `recoverStaleProcessing`: `PROCESSING` com `processing_started_at` > 10 min → libera para pendente

---

## 9. Dispatcher

**Arquivo:** `HospedinOutboundDispatcher.ts`

### 9.1 `has_pending`

- **Não é a fila.** Wake-up em `integration_provider_state.has_pending`.
- `setOutboundHasPendingTrue()` ao enqueue/retry/pending cancel
- `tryClearOutboundPendingIfIdle()` zera só se **não** existir claimable

### 9.2 Trigger

```
markDirty / markOutboundCancelled / releaseToPending
  → notifyOutboundPendingIfClaimable
  → markOutboundPendingAndDispatch
  → has_pending=1 + scheduleOutboundDispatch('signal')
```

### 9.3 Fluxo `dispatch` / `drainClaimableQueue`

1. Mutex processo: `dispatchRunning` + `pendingTailDispatch`
2. Loop até 500 rounds:
   - Se `!hasPending` mas `countClaimableOutbound() > 0` → re-sinaliza
   - Skip se `providerRunLock` locked
   - `listDue(1)` → `runProviderCycle('HOSPEDIN_OUTBOUND', trigger)`
   - Trigger: `signal` → `WEBHOOK`; `watchdog` → `SCHEDULER`
3. Sem due → `tryClearOutboundPendingIfIdle()`

### 9.4 Mutex

| Mecanismo | Escopo |
|-----------|--------|
| `dispatchRunning` | Processo Node |
| `providerRunLock` | Memória local por provider |
| `tryClaim` | MySQL atômico por linha |

### 9.5 Fila vazia

Quando não há due claimable: clear `has_pending` se idle; dispatcher encerra round sem HTTP.

---

## 10. Watchdog

### Finalidade

Recuperação quando:

- `has_pending=0` mas ainda há claimables (falha do trigger)
- Após restart com pendências persistidas
- Provider habilitado sem dispatch recente

### Intervalo

- Scheduler tick global: **30s** (`IntegrationScheduler.ts`, `TICK_MS`)
- Watchdog outbound: `integration_provider_config.interval_minutes` do provider `HOSPEDIN_OUTBOUND`
- Default env: **15 minutos** (`HOSPEDIN_OUTBOUND_SYNC_INTERVAL_MINUTES`)

### Comportamento (`runWatchdogIfDue`)

1. Só roda se provider **enabled** e `next_run_at <= now`
2. Skip se `integration_provider_state.status === RUNNING`
3. Se `claimable > 0` e `has_pending=0` → warn + `setOutboundHasPendingTrue`
4. Dispara `dispatch('watchdog')` se não há dispatch/lock ativo
5. Agenda próximo `next_run_at = now + interval_minutes`

### Configuração atual em produção

**NÃO DOCUMENTADO/CONFIRMAR** — valores live em `integration_provider_config` / `integration_provider_state`.  
Homologação final (`_homolog-final-dispatch-127.js`) habilitou `enabled=1`, `interval_minutes=15` e relatório de sessão indicou provider **deixado habilitado** após teste — **confirmar no banco antes de operar**.

---

## 11. Concorrência

### `tryClaim`

Protege **a mesma linha** de processamento duplo via UPDATE condicional no MySQL.

### Mutex local

`providerRunLock` e `dispatchRunning` **não** protegem entre instâncias Node distintas.

### Risco multi-instance atual

| Cenário | Risco |
|---------|-------|
| Mesma reserva, duas instâncias | Mitigado por `tryClaim` |
| Duas instâncias, reservas diferentes | **Esperado** — paralelismo |
| Duas instâncias, mesmo provider cycle | Possível overlap; lock só in-process |

**NÃO DOCUMENTADO/CONFIRMAR:** lock distribuído cross-instance além de `tryClaim`.

---

## 12. Scheduler

### Diferença inbound vs outbound

| | Providers inbound (`HOSPEDIN`, etc.) | `HOSPEDIN_OUTBOUND` |
|---|--------------------------------------|---------------------|
| Tick 30s | `runProviderCycle` se `next_run_at` due | **Apenas** `runWatchdogIfDue()` |
| `interval_minutes` | Intervalo de sync periódico | Intervalo do **watchdog** |
| Disparo principal | Scheduler / webhook | `has_pending` + dispatcher `signal` |
| `webhookEnabled` | Configurável | `false` (fixo no provider) |

Código: `IntegrationScheduler.ts` linhas 93–96.

### Configuração atual

Ver [§16](#16-configuração) e [§19](#19-estado-atual-conhecido).

---

## 13. Inbound (não alterar)

O outbound **não deve**:

- Escrever em `integration_sync_state`, staging `hospedin_*`, ou logs inbound
- Alterar `origemReserva` para `HOSPEDIN` em reservas criadas no Jango
- Sobrescrever reservas com `origemReserva !== 'HOSPEDIN'` via pipeline inbound
- Sincronizar financeiro em qualquer direção

Alterações no outbound **não substituem** homologação inbound RFC-002.

Referência inbound: [`docs/integrations/hospedin.md`](../../../docs/integrations/hospedin.md), [`hospedin-rfc002-fase2-decisoes.md`](../../../docs/integrations/hospedin-rfc002-fase2-decisoes.md).

---

## 14. Origem (`origemReserva`)

### Regra outbound (`isOriginEligibleForOutbound`)

```typescript
// HospedinOutboundEnqueueService.ts
if (origemReserva === 'HOSPEDIN') return false;  // nunca enfileira
if (tipoEvento && tipoEvento !== 'Pousada') return false;
return true;
```

### Regras obrigatórias

1. Reserva importada do Hospedin (**`origemReserva === 'HOSPEDIN'`**) → **silenciosamente ignorada** no outbound (sem fila).
2. Outbound **nunca** deve alterar `origemReserva` para `HOSPEDIN` em reservas Jango/ATENDENTE/SITE.
3. Inbound UPDATE só sobrescreve reservas `origemReserva === 'HOSPEDIN'` (regra separada — não quebrar).

---

## 15. Banco e migrations

### Tabelas

| Tabela | Papel |
|--------|-------|
| `hospedin_outbound_sync_state` | Fila outbound (1 linha por `id_reserva_hospedagem`) |
| `integration_provider_config` | Config `HOSPEDIN_OUTBOUND` |
| `integration_provider_state` | Runtime + `has_pending` |
| `integration_sync_execution` | Histórico de execuções |
| `hospedin_place_suite_map` | Mapeamento suíte (pré-condição CREATE/UPDATE) |
| `ReservaHospedagem` | `id_externo`, `codigo_externo`, `origem_reserva` |

### Scripts SQL (ordem sugerida)

1. `scripts/create-hospedin-outbound-sync-state.sql` — tabela fila
2. `scripts/alter-hospedin-outbound-synced-hash-input.sql` — coluna `synced_hash_input_json`
3. `scripts/alter-integration-provider-state-has-pending.sql` — coluna `has_pending`
4. `scripts/create-hospedin-place-suite-map.sql` — mapeamento (pré-requisito operacional)

### `has_pending`

```sql
ALTER TABLE integration_provider_state
  ADD COLUMN has_pending TINYINT(1) NOT NULL DEFAULT 0;
```

Wake-up apenas; fila real permanece em `hospedin_outbound_sync_state`.

---

## 16. Configuração

Provider ID: **`HOSPEDIN_OUTBOUND`**

Defaults (`HospedinOutboundSyncProvider.getEnvDefaults()`):

| Campo | Variável de ambiente | Default |
|-------|---------------------|---------|
| `enabled` | `HOSPEDIN_OUTBOUND_SYNC_ENABLED` | **`false`** |
| `interval_minutes` | `HOSPEDIN_OUTBOUND_SYNC_INTERVAL_MINUTES` | **15** |
| `sync_limit` | `HOSPEDIN_OUTBOUND_SYNC_LIMIT` | **30** |
| `priority` | `HOSPEDIN_OUTBOUND_SYNC_PRIORITY` | **110** |
| `max_retries` | `HOSPEDIN_OUTBOUND_SYNC_MAX_RETRIES` | **5** |
| `backoff_base_seconds` | `HOSPEDIN_OUTBOUND_SYNC_BACKOFF_BASE_SECONDS` | **30** |
| `mode` | — | `incremental` |
| `webhookEnabled` | — | `false` |

Runner lê `max_retries` e `backoff_base_seconds` das mesmas env vars.

**Valores atuais no banco:** NÃO DOCUMENTADO/CONFIRMAR (consultar `integration_provider_config`).

---

## 17. Testes automatizados

Comandos (`ticket-node/package.json`):

| Script npm | Arquivo(s) | Foco |
|------------|------------|------|
| `test:outbound-payload` | `HospedinOutboundPayloadBuilder.test.ts` | Formato datas; payload CREATE; classificação HTTP |
| `test:outbound-snapshot` | `HospedinOutboundSnapshot.test.ts` | Campos do hash; diff; PATCH; check-in/out sem diff |
| `test:outbound-update` | `HospedinOutboundUpdate.test.ts` | Observações/hash; PATCH mínimo; idempotência; 404/409; stale |
| `test:outbound-cancel` | `HospedinOutboundCancel.test.ts` | PATCH cancel; GET idempotente; enqueue helpers |
| `test:outbound-create-race` | `HospedinOutboundCreateRace.test.ts` | Race CREATE×CANCEL; finalize; single POST |
| `test:outbound-dispatcher` | `HospedinOutboundDispatcher.test.ts` + `.integration.test.ts` | Claimable; mutex; markDirty→dispatch; watchdog; disabled provider |

### Resultados (última execução registrada em desenvolvimento, 2026-09-03)

| Suite | Testes | Resultado |
|-------|--------|-----------|
| `test:outbound-payload` | 6 | pass |
| `test:outbound-snapshot` | 11 | pass |
| `test:outbound-update` | 16 | pass |
| `test:outbound-cancel` | 18 | pass |
| `test:outbound-create-race` | 11 | pass |
| `test:outbound-dispatcher` | 13 | pass |
| **Total outbound** | **75** | **pass** |

**Nota:** `npm test` agregado **não inclui** `test:outbound-dispatcher` — rodar explicitamente antes de releases outbound.

Todos os testes são offline (sem HTTP real ao Hospedin), exceto integração dispatcher com store em memória.

---

## 18. Homologações reais

Scripts em `ticket-node/scripts/`. Evidência em logs commitados **limitada** — ver coluna “Log”.

### Reservas de referência (protegidas em scripts)

| ID Jango | Papel | Hospedin ID (esperado) | Estado esperado pós-homolog (preflight `_homolog-final-dispatch-127.js`) |
|----------|-------|------------------------|---------------------------------------------------------------------------|
| **127** | CREATE + UPDATE (obs, período, suíte) | `30295972` (`HO:001321`) | `SYNCED`, `desired_action=UPDATE` |
| **128** | CREATE + CANCEL outbound | `30297720` (`HO:001323`) | `SYNCED`, `desired_action=CANCEL` |
| **129** | Cancel antes do CREATE | dinâmico na etapa 7.8 | `ABORTED` |
| 124, 126 | Isolamento / abort | — | `ABORTED` |

### #127 — CREATE / UPDATE

| Etapa | Script | Log / resultado |
|-------|--------|-----------------|
| CREATE real | `_homolog-etapa3-outbound-create-real.js` | **NÃO DOCUMENTADO/CONFIRMAR** (sem log commitado) |
| UPDATE obs | `_homolog-etapa4-outbound-update-real.js` | **NÃO DOCUMENTADO/CONFIRMAR** |
| UPDATE período+suíte | `_homolog-etapa5-outbound-update-periodo-suite-real.js` | `_homolog-etapa53-run.log` — **FAIL** restore (2 PATCH vs 1 esperado); PATCHs HTTP 200 |
| Troca suíte TESTE2 | `_homolog-etapa53-teste2-suite-real.js` | `_homolog-etapa53-teste2-execute-run.log` — runner `updated`, restore Tulipa falhou (validação admin suíte, **fora do outbound**) |
| Recovery Tulipa | `_recover-etapa53-restore-tulipa-real.js` | `_recover-etapa53-run.log` — **SUCESSO** |
| Dispatch final | `_homolog-final-dispatch-127.js` | **NÃO DOCUMENTADO/CONFIRMAR** (sem log commitado); relatório de sessão: dispatch ~1,3s via `WEBHOOK`, PATCH obs OK, restore OK, `has_pending=0`, `claimable=0` |

### #128 — CREATE / CANCEL

| Etapa | Script | Resultado |
|-------|--------|-----------|
| 7.4 prepare | `_homolog-etapa74-prepare-cancel-outbound.js` | **NÃO DOCUMENTADO/CONFIRMAR** |
| 7.5 CREATE | `_homolog-etapa75-create-128.js` | Script declara sucesso esperado |
| 7.6 cancel Jango | `_homolog-etapa76-cancel-128.js` | **NÃO DOCUMENTADO/CONFIRMAR** |
| 7.7 CANCEL outbound | `_homolog-etapa77-cancel-outbound-128.js` | PATCH `status=canceled`; guest `22620073` no script |

### #129 — CANCEL antes do CREATE

| Etapa | Script | Resultado |
|-------|--------|-----------|
| 7.8 | `_homolog-etapa78-cancel-before-create.js` | Cria reserva descartável; cancela antes do POST; espera `ABORTED` / sem POST |
| ID fixo | — | **NÃO é #129 fixo** — etapa 7.8 cria reserva dinâmica; #129 usado em auditoria 7.9 como ID protegido |

### Auditoria read-only

`_homolog-etapa79-audit-readonly.js` — snapshot #124–#129, fila due, config scheduler. **Sem log commitado.**

### Demais

- `_homolog-etapa2-outbound.js` — dry-run fila (sem HTTP)
- Cancelamento API homologado (doc `hospedin.md` §11): PATCH `{ status: "canceled" }` — conta `69532`, reserva descartável `30297436`

---

## 19. Estado atual conhecido

| Item | Valor | Confiança |
|------|-------|-----------|
| Provider `HOSPEDIN_OUTBOUND` | Existe no registry | Código |
| Default `enabled` | `false` (env/seed) | Código |
| Watchdog default | 15 min | Código + homolog script |
| Provider habilitado após homolog final | `enabled=1` relatado | **NÃO DOCUMENTADO/CONFIRMAR** (consultar DB) |
| Fila sem claimables | `claimable=0` após homolog final | **NÃO DOCUMENTADO/CONFIRMAR** |
| #127 | `SYNCED`, Hospedin `30295972` | Script preflight + sessão homolog |
| #128 | `SYNCED`/`CANCEL`, Hospedin `30297720` | Script preflight |
| #124, #126, #129 | `ABORTED` | Script preflight |

---

## 20. Regras obrigatórias para futuras alterações

### Nunca quebrar

1. Fila outbound separada de `integration_sync_state` (inbound).
2. `origemReserva === 'HOSPEDIN'` nunca entra no outbound.
3. Outbound nunca define `origemReserva` como `HOSPEDIN`.
4. Sem sync financeira (transactions, sales, rates).
5. UPDATE: hash só campos operacionais listados em §5.1.
6. CANCEL sem vínculo → `ABORTED`, nunca POST.
7. Race CREATE×CANCEL: CAS em `finalizeCreateAfterPost`.
8. `tryClaim` atômico antes de HTTP.
9. PATCH UPDATE mínimo (sem campos inalterados).
10. 409 UPDATE → FAILED permanente (sem retry).
11. 404 UPDATE/CANCEL → sem recriar reserva.
12. `markDirty` não sobrescreve `PENDING_CANCEL` / `ABORTED`.
13. Dispatcher: fila real em `hospedin_outbound_sync_state`; `has_pending` só wake-up.
14. Scheduler: outbound não usa tick periódico de `runProviderCycle` — só watchdog + signal.

### Não alterar sem homologação dedicada

- `HospedinOutboundEnqueueService` (origem, pré-condições)
- `HospedinOutboundSnapshot` / hash input
- `HospedinOutboundCreateService` / `finalizeCreateAfterPost`
- `HospedinOutboundCancelService`
- `HospedinOutboundDispatcher` (mutex, clear, drain)
- Classificação de erros HTTP

---

## 21. Troubleshooting (estados)

| Estado | Significado | Tratamento |
|--------|-------------|------------|
| `PENDING_CREATE` | Aguardando POST inicial | Verificar pré-condições (`BLOCKED`?), status Jango elegível, mapeamento suíte |
| `PENDING_UPDATE` | Hash mudou após sync | Aguardar dispatcher ou inspecionar `pending_payload_hash` vs `payload_hash` |
| `PENDING_CANCEL` | Cancel Jango com vínculo Hospedin | Runner deve GET+PATCH; verificar `hospedin_reservation_id` |
| `WAIT_RETRY` | Falha retryável | Ver `next_retry_at`, `retry_count`, `last_error`, `error_code` |
| `PROCESSING` | Em execução | Se travado >10 min → `recoverStaleProcessing` no próximo cycle |
| `SYNCED` | Última ação ok | Normal; novo `markDirty` reabre pendência se hash mudar |
| `FAILED` | Erro permanente ou max retries | Ver `error_code`; `RECONCILE_REQUIRED` = alinhar manualmente IDs/hash |
| `BLOCKED` | Pré-condição | `SUITE_UNMAPPED` / `GUEST_NAME_MISSING` / `SUITE_LINE_MISSING` — corrigir dados Jango |
| `ABORTED` | Cancel sem vínculo ou CREATE abortado | **Terminal** — não reenviar; não POST |
| `RECONCILE_REQUIRED` | (`error_code`, não status) | Hospedin ok, persistência local falhou — reconciliação manual |

### `error_code` frequentes

`CREATE_ABORTED`, `HOSPEDIN_ID_MISSING`, `RESERVATION_NOT_FOUND`, `HTTP_409`, `VALIDATION_ERROR`, `AUTH_ERROR`, `RATE_LIMITED`, `HTTP_5XX`, `NETWORK_ERROR`, `UNSUPPORTED_CHANGE`, `CANCEL_NOT_CONFIRMED`, `JANGO_NOT_CANCELLED`, `RECONCILE_REQUIRED`

---

## 22. Guia para futuras alterações

### Antes de codar

1. Ler **este documento** integralmente.
2. Ler § inbound em `docs/integrations/hospedin.md` se a mudança tocar fronteira inbound/outbound.
3. Identificar se a mudança afeta CREATE, UPDATE, CANCEL, fila, dispatcher ou origem.
4. Verificar se está fora do escopo financeiro (§3).

### Durante implementação

- Alterações pequenas e focadas; não misturar com refatoração unrelated.
- Preservar contratos de hash e PATCH mínimo.
- Novos gatilhos `markDirty` → documentar neste arquivo (§4.1).
- Novos `error_code` → documentar em §21.

### Antes de merge/deploy

```bash
cd ticket-node
npm run test:outbound-payload
npm run test:outbound-snapshot
npm run test:outbound-update
npm run test:outbound-cancel
npm run test:outbound-create-race
npm run test:outbound-dispatcher
npm run build
```

Homologação real: seguir scripts `_homolog-etapa*.js` — **nunca** contra #127/#128 sem entender preflight de proteção.

### Documentação

Atualizar **este arquivo** quando mudar comportamento homologado. Não depender só de `docs/integrations/hospedin.md` §11 (resumo legado).

---

## Referências de código

| Componente | Caminho |
|------------|---------|
| Enqueue | `outbound/HospedinOutboundEnqueueService.ts` |
| State | `outbound/HospedinOutboundStateService.ts` |
| Runner | `outbound/HospedinOutboundRunner.ts` |
| CREATE | `outbound/HospedinOutboundCreateService.ts` |
| UPDATE | `outbound/HospedinOutboundUpdateService.ts` |
| CANCEL | `outbound/HospedinOutboundCancelService.ts` |
| Snapshot/hash | `outbound/HospedinOutboundSnapshot.ts` |
| Payload/PATCH | `outbound/HospedinOutboundPayloadBuilder.ts` |
| Dispatcher | `outbound/HospedinOutboundDispatcher.ts` |
| Provider | `outbound/HospedinOutboundSyncProvider.ts` |
| Scheduler | `integrations/core/IntegrationScheduler.ts` |
| Model fila | `models/HospedinOutboundSyncState.ts` |

---

## Lacunas documentadas (pendências)

1. Valores **live** de `integration_provider_config` / `has_pending` / claimables no ambiente atual.
2. Logs commitados incompletos para etapas 3, 4, 7.5–7.9 e homolog final dispatch.
3. `docs/integrations/hospedin.md` cabeçalho contradiz existência do outbound — considerar atualizar **apenas** cross-link para este doc (fora do escopo desta tarefa se restrito a um arquivo).
4. `npm test` não roda `test:outbound-dispatcher` automaticamente.
5. Política operacional formal para `RECONCILE_REQUIRED` / `FAILED` em produção — **NÃO DOCUMENTADO/CONFIRMAR**.

---

*Documento gerado por auditoria de código e docs existentes. Nenhuma lógica, configuração ou banco foi alterado na sua elaboração.*
