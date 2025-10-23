document.addEventListener('DOMContentLoaded', async function () {
  // token 
  function getAntiCsrfFromDom() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el?.value?.trim() || null;
  }

  async function getUserBearerToken() {
    try {
      const base = window.location.origin;
      const userId = Number(document.querySelector('#userId')?.value?.match(/\d+$/)?.[0]);
      if (!Number.isFinite(userId)) throw new Error('ID do usuário não encontrado.');

      const dsKey = base.includes('hml')
        ? 'yjbbrV4FLfJUDeTgo97d3CmCz9CCIBqtlH2OupdGmAiSrUr8-LKFdChlE37fCDRMhGf@-i0xUw8t9Pl8mXHU6w__'
        : 'DDwgBioycx75M0IiEFF-sdk0HwdR17CgcklxG-9Wy5WHeAyX4eV9pCstsjxLBqOYG2SnaXgEA6YhPK1R8LpVdw__';

      // 1) token da datasource
      const ds = await fetch(`https://hmlraizeducacao.zeev.it/api/internal/legacy/1.0/datasource/get/1.0/${dsKey}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      }).then(r => r.ok ? r.json() : Promise.reject(r));
      const apiToken = ds?.success?.[0]?.cod;
      if (!apiToken) throw new Error('apiToken ausente');
      console.log('dsKey usado:', dsKey);
      console.log("🔍 Buscando datasource em:", `https://hmlraizeducacao.zeev.it/api/internal/legacy/1.0/datasource/get/1.0/${dsKey}`);
      console.log("📦 Resposta bruta:", ds);



      // 2) token temporário (impersonate)
      const imp = await fetch(`https://hmlraizeducacao.zeev.it/api/2/tokens/impersonate/${userId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        credentials: 'include'
      }).then(r => r.ok ? r.json() : Promise.reject(r));
      const bearer = imp?.impersonate?.temporaryToken;
      if (!bearer) {
         console.warn("⚠️ Bearer não encontrado — tentando continuar com sessão atual...");
      }
      return bearer;
      
    } catch (e) {
      console.error('Falha ao obter bearer do usuário:', e);
      return null;
    }
  }

  function montarHeaders(antiCsrf, bearer) {
    const h = { 'Accept': 'application/json' };
    if (antiCsrf) h['x-sml-antiforgerytoken'] = antiCsrf;
    if (bearer)   h['Authorization'] = `Bearer ${bearer}`;
    return h;
  }

  // ?? tudo dentro do escopo async, agora o await é permitido
  const anti = getAntiCsrfFromDom();
  const bearer = await getUserBearerToken(); 
  const headers = montarHeaders(anti, bearer);
// URL base da API de tarefas
const urlTarefas = `https://hmlraizeducacao.zeev.it/api/2/assignments/`;

try {
  // Buscar as tarefas
  const resposta = await fetch(urlTarefas, { method: "GET", headers, credentials: "include" });
  if (!resposta.ok) {
    console.error("❌ Erro ao buscar tarefas:", resposta.status, resposta.statusText);
    return;
  }

  const dados = await resposta.json();
  console.log("📦 Dados recebidos:", dados);

  // Filtrar somente as tarefas "Avaliar atendimento"
  const tarefasEncontradas = dados.filter(t => t.taskName?.trim() === "Avaliar atendimento");
  if (tarefasEncontradas.length === 0) {
    console.log("⚠️ Nenhuma tarefa 'Avaliar atendimento' encontrada.");
    return;
  }

  // Configurações
  const tokenResponsavel = "087FJWX5jKVEHZs8BBa%2FOcf36SKh5gpE1FzOx7GSp6UrT0X5iq5ALc72%2Fv6RIfekiORiQ0PuaHZyq1PgUQ30qmy2EfvRo0Vjr0yx0xniRTUCCf4fU71U5KIMfxozTSh0";
  const idUsuarioResponsavel = 4101; // ID do usuário que receberá as tarefas no forward
  const emailParaVerificar  = "ticket.raiz@raizeducacao.com.br";

  for (const tarefa of tarefasEncontradas) {
    const idTarefa = tarefa.id;
    const emailResponsavel = tarefa.assignee?.email || "";
    console.log(`🧩 Tarefa ${idTarefa} | responsável atual: ${emailResponsavel}`);

    // -----------------------------------------------------------
    // ETAPA 1 — FORWARD (somente se o e-mail for DIFERENTE)
    // -----------------------------------------------------------
    if (emailResponsavel !== emailParaVerificar) {
      const urlForward = `https://hmlraizeducacao.zeev.it/api/2/assignments/forward`;
      const corpoForward = {
        newUserId: idUsuarioResponsavel,
        assignmentsIds: [idTarefa],
        message: "Reatribuição automática via API"
      };

      try {
        const respForward = await fetch(urlForward, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenResponsavel}`
          },
          body: JSON.stringify(corpoForward),
          credentials: "include"
        });

        if (!respForward.ok) {
          const erroTxt = await respForward.text();
          console.error(`❌ Erro no forward da tarefa ${idTarefa}:`, erroTxt);
        } else {
          console.log(`✅ Forward executado para a tarefa ${idTarefa}.`);
        }
      } catch (e) {
        console.error(`💥 Falha no forward da tarefa ${idTarefa}:`, e);
      }

      // IMPORTANTE: pela sua regra, NÃO executa PUT aqui.
      continue;
    }

    // -----------------------------------------------------------
    // ETAPA 2 — PUT (somente se o e-mail for IGUAL)
    // -----------------------------------------------------------
    if (emailResponsavel === emailParaVerificar) {
      const urlPut = `https://hmlraizeducacao.zeev.it/api/2/assignments/${idTarefa}`;
      const corpoPut = {
        result: "3",
        reason: "Tarefa concluída automaticamente via API"
      };

      try {
        const respPut = await fetch(urlPut, {
          method: "PUT",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenResponsavel}`
          },
          body: JSON.stringify(corpoPut),
          credentials: "include"
        });

        if (respPut.status === 204) {
          console.log(`✅ Tarefa ${idTarefa} concluída (204 No Content).`);
          continue;
        }

        if (!respPut.ok) {
          const erroTxt = await respPut.text();
          console.error(`❌ Erro ao concluir tarefa ${idTarefa}:`, erroTxt);
          continue;
        }

        const ct = respPut.headers.get("content-type") || "";
        const retorno = ct.includes("application/json") ? await respPut.json() : await respPut.text();
        console.log(`✅ PUT bem-sucedido para ${idTarefa}:`, retorno);

      } catch (e) {
        console.error(`💥 Falha ao concluir tarefa ${idTarefa}:`, e);
      }
    }
  }
} catch (erro) {
  console.error("💥 Erro geral na execução:", erro);
}
});
