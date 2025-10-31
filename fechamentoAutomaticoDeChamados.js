import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

 
// CONFIGURAÇÕES GERAIS
 
const base = process.env.ZEEV_BASE;
const tokenTicket = process.env.ZEEV_TOKEN_TICKET;
const logFile = process.env.LOG_FILE || "automacao.log";

const idUsuarioTicketRaiz = 4101;
const emailTicketRaiz = "ticket.raiz@raizeducacao.com.br";

// Delays (em milissegundos)
const DELAY_TAREFA_MIN = 400;
const DELAY_TAREFA_MAX = 800;
const DELAY_USUARIO_MIN = 1000;
const DELAY_USUARIO_MAX = 1800;

 
//  SISTEMA DE LOG
 
const logPath = path.resolve(logFile);
function timestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}
function log(msg, tipo = "INFO") {
  const linha = `[${timestamp()}] [${tipo}] ${msg}`;
  console.log(linha);
  fs.appendFileSync(logPath, linha + "\n", "utf8");
}

 
// ⏱ DELAY COM JITTER ALEATÓRIO
 
async function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(r => setTimeout(r, ms));
}

 
// 🔹 FUNÇÕES AUXILIARES
 

// 1️⃣ Buscar tarefas “Avaliar atendimento” atrasadas
async function buscarTarefasAtrasadas(tokenUser) {
  let page = 1;
  const tarefasAtrasadas = [];

  while (true) {
    const url = `${base}/api/2/assignments/?pageNumber=${page}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenUser}`,
        Accept: "application/json"
      }
    });
    if (!resp.ok) throw new Error(`Erro ao buscar tarefas (${resp.status})`);

    const payload = await resp.json();

    // A API pode retornar um array direto ou algo como { items: [...] }
    const tarefas = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.items) ? payload.items : []);

    // *** Ponto de parada: quando vier vazio, acabou. ***
    if (tarefas.length === 0) break;

    // Filtro exato
    for (const t of tarefas) {
      if (t?.taskName?.trim() === "Avaliar atendimento" && t?.late === true) {
        tarefasAtrasadas.push(t);
      }
    }

    page++;
    // (Opcional) proteção contra loop infinito:
    if (page > 10000) throw new Error("Proteção: possível loop de paginação.");
  }

  return tarefasAtrasadas;
}


// 2️⃣ Gerar temporaryToken para um usuário específico
async function getUserToken(userId) {
  const url = `${base}/api/2/tokens/impersonate/${userId}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${tokenTicket}` }
  });

  if (!resp.ok) {
    log(`❌ Falha ao impersonar usuário ${userId} (${resp.status})`, "ERRO");
    return null;
  }

  const data = await resp.json();
  return data?.impersonate?.temporaryToken || null;
}

// 3️⃣ Encaminhar tarefa (forward)
async function forwardTarefa(tokenUser, tarefaId) {
  const url = `${base}/api/2/assignments/forward`;
  const body = {
    newUserId: idUsuarioTicketRaiz,
    assignmentsIds: [tarefaId],
    message: "Reatribuição automática via API"
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenUser}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro no encaminhamento da tarefa ${tarefaId}: ${txt}`);
  }

  log(`✅ Encaminhamento da tarefa ${tarefaId} para o ticket.raiz realizado com sucesso.`);
}

// 4️⃣ Concluir tarefa automaticamente
async function concluirTarefa(tokenUser, tarefaId) {
  const url = `${base}/api/2/assignments/${tarefaId}`;
  const body = {
    result: "3",
    reason: "SLA expirado — finalizada automaticamente via API."
  };

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokenUser}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (resp.status === 204) {
    log(`✅ Tarefa ${tarefaId} concluída (204).`);
  } else if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro ao concluir ${tarefaId}: ${txt}`);
  }
}

// 5️⃣ Listar e processar usuários por página
async function processarUsuariosPorPagina() {
  let pageNumber = 5;             // <<<<<<<<<<<<<<<          Modifique o número da página inicial aqui de acordo com sua necessidade se o código que contém uma ⭐ estiver comentado. Se não, deixe como 1.
  const numeroDeUsuarios = 1000;

  while (true) {
    const url = `${base}/api/2/users?pageNumber=${pageNumber}`;
    log(`🌐 Buscando usuários (pageNumber=${pageNumber})...`);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenTicket}`,
        Accept: "application/json"
      }
    });

    if (!resp.ok) {
      log(`⚠️ Erro ao buscar pageNumber=${pageNumber} (${resp.status}).`, "WARN");
      break;
    }

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      log(`📘 Nenhum usuário retornado na página ${pageNumber}) — fim da paginação.`);
      break;
    }

    log(`📄 Página ${pageNumber}: ${data.length} usuários retornados.`);
    log(`🧮 Iniciando processamento de ${data.length} usuários...`);

    for (const u of data) {
      if (!u?.isActive) continue;
      if (u.email === emailTicketRaiz) continue;

      const { id, username, email } = u;
      log(`🔹 Verificando usuário: ${username || id} (${email || "sem email"})`);

      const tokenUser = await getUserToken(id);
      if (!tokenUser) {
        log(`⚠️ Falha ao impersonar ${email || id}`, "WARN");
        await delay(DELAY_USUARIO_MIN, DELAY_USUARIO_MAX);
        continue;
      }

      const tarefas = await buscarTarefasAtrasadas(tokenUser);
      if (!tarefas?.length) {
        log("ℹ️ Nenhuma tarefa 'Avaliar atendimento' atrasada.");
        await delay(DELAY_USUARIO_MIN, DELAY_USUARIO_MAX);
        continue;
      }

      log(`📋 ${tarefas.length} tarefas "Avaliar atendimento" atrasadas encontradas.`);
      for (const tarefa of tarefas) {
        await forwardTarefa(tokenUser, tarefa.id);
        await delay(DELAY_TAREFA_MIN, DELAY_TAREFA_MAX);
      }

      await delay(DELAY_USUARIO_MIN, DELAY_USUARIO_MAX);
    }
    /* // ⭐ PARA QUE PERCORRAR TODAS AS PÁGINAS EXISTENTES DE UMA VEZ, DESCOMENTE ESTE TRECHO:
    
    if (data.length < 1) {
      log(`📘 Página ${pageNumber} retornou ${data.length} usuários. Fim da paginação.`);
      break; 
    }
    
    */ 

    if (data.length < numeroDeUsuarios) {
      log(`📘 Página ${pageNumber} retornou ${data.length} usuários (<=${numeroDeUsuarios}). Fim da paginação.`);
      break; 
    }

    pageNumber++;
    await delay(500, 1000);
  }
}

 
// 🔹 EXECUÇÃO PRINCIPAL
 
async function main() {
  log("🚀 Iniciando automação com token do ticket.raiz...");
  try {
    await processarUsuariosPorPagina();

    // Processa o ticket.raiz no final (sem impersonate)
    log("🏁 Iniciando etapa final: conclusão automática de tarefas de 'Avaliar antendimento' do ticket.raiz...");

    try {
      const urlUsuarios = `${base}/api/2/users`;
      const resp = await fetch(urlUsuarios, {
        headers: { Authorization: `Bearer ${tokenTicket}` }
      });
      const usuarios = await resp.json();
      const usuarioTicket = usuarios.find(u => u.email === emailTicketRaiz);

      /*if (usuarioTicket) {
        log("✅ Usuário ticket.raiz encontrado entre os ativos.");
      } else {
        log("⚠️ Usuário ticket.raiz não encontrado entre os ativos. Prosseguindo com o token do .env.", "WARN");
      }*/

      const tarefasRaiz = await buscarTarefasAtrasadas(tokenTicket);
      if (!tarefasRaiz?.length) {
        log("ℹ️ Nenhuma tarefa atrasada atribuída ao ticket.raiz.");
      } else {
        log(`📬 ${tarefasRaiz.length} tarefas atrasadas encontradas com ticket.raiz.`);
        for (const tarefa of tarefasRaiz) {
          await concluirTarefa(tokenTicket, tarefa.id);
          await delay(DELAY_TAREFA_MIN, DELAY_TAREFA_MAX);
        }
      }
    } catch (err) {
      log(`⚠️ Erro ao processar etapa do ticket.raiz: ${err.message}`, "WARN");
    }

    log("✅ Automação concluída com sucesso.");
  } catch (e) {
    log(`💥 Erro geral: ${e.message}`, "ERRO");
  }
}

main();
