import { Sequelize } from "sequelize";
import { Torneio, TorneioBlindItem } from "../models/Torneio";
import { enviarAtualizacaoTorneio } from "./TorneioWebSocket";
import { Ticket } from "../models/Ticket";

let timerId: NodeJS.Timeout | null = null; // Armazena o ID do timer para poder limpar o intervalo

// Variável global para controlar a atualização do torneio
export let atualizarTorneio = false;

// Função que busca o torneio em andamento ou parado no banco
async function buscarTorneioEmAndamentoOuParado(): Promise<Torneio | null> {
    const torneio = await Torneio.findOne({
        where: {
            status: ['Criado', 'parado', 'em andamento'],
        },
        include: [{
            model: TorneioBlindItem,
            as: 'blindItem',
            required: false,
        }],
    });

    if (torneio) {
        torneio.setDataValue('quantidadeTicketsUtilizados', await buscarQuantidadeTicketsUtilizados(torneio.id));
    }

    return torneio || null;
}

// Função separada para buscar a quantidade de tickets utilizados
async function buscarQuantidadeTicketsUtilizados(torneioId: number): Promise<number> {
    const quantidadeTicketUtilizados = await Ticket.count({
        where: {
            torneioId,
            status: 'utilizado',
        },
    });
    return quantidadeTicketUtilizados;
}

async function buscarProximoNivel(torneio: Torneio): Promise<TorneioBlindItem> {
    const blinds = await TorneioBlindItem.findAll({
        where: { torneioId: torneio.id },
        order: [['order', 'ASC']],
    });

    const indiceBlindAtual = blinds.findIndex(b => b.id === torneio.blindItemAtual);
    return blinds[indiceBlindAtual + 1] || null;
}

async function buscarEEnviarTorneio() {
    const torneio = await buscarTorneioEmAndamentoOuParado();
    if (!torneio) {
        console.log('Nenhum torneio encontrado');
        return;
    }

    const blind = await buscarProximoNivel(torneio);

    if (torneio) {
        enviarAtualizacaoTorneio(torneio);
    } else {
        console.log('Nenhum torneio encontrado');
    }
}

// Função que inicia o torneio e a contagem dos blinds
async function iniciarTorneio(callback: (torneio: any) => void): Promise<Torneio> {
    const torneio = await buscarTorneioEmAndamentoOuParado();
    if (!torneio) {
        throw new Error('Nenhum torneio disponível para iniciar.');
    }
    const proximoNivel = await buscarProximoNivel(torneio);

    if (!torneio) {
        throw new Error('Nenhum torneio disponível para iniciar.');
    }

    if (torneio.status === 'em andamento') {
        throw new Error('Torneio já está em andamento.');
    }

    torneio.status = 'em andamento';
    await torneio.save();

    iniciarContagemBlinds(torneio, proximoNivel, callback);

    return torneio;
}

// Função que pausa o torneio
async function pararTorneio(): Promise<Torneio> {
    const torneio = await buscarTorneioEmAndamentoOuParado();

    if (!torneio || torneio.status !== 'em andamento') {
        throw new Error('Torneio não está em andamento.');
    }

    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }

    torneio.status = 'parado';
    await Torneio.update({ status: 'parado' }, { where: { id: torneio.id } });

    return torneio;
}

// Função responsável por iniciar a contagem regressiva dos blinds
function iniciarContagemBlinds(torneio: Torneio, proximoNivel: TorneioBlindItem, callback: (torneio: any) => void): void {
    if (timerId) {
        clearInterval(timerId);
    }
    // let atualizarTorneio = false

    timerId = setInterval(async () => {
        torneio.tempoRestanteNivel--;
        if (torneio.tempoRestanteNivel <= 0) {
            await trocarNivel(torneio, callback);
            atualizarTorneio = true
        }
        // Atualiza o torneio a cada segundo
        await torneio.save();

        if (atualizarTorneio) {
            let torneioAtualizado = await buscarTorneioEmAndamentoOuParado();

            proximoNivel = await buscarProximoNivel(torneio);

            if (torneioAtualizado) {
                torneio = torneioAtualizado;
                atualizarTorneio = false
            } else {
                throw new Error('Erro ao atualizar o torneio.');
            }
        }
        // Chama o callback sempre com o torneio atualizado e o próximo nível
        callback({ torneio, proximoNivel });
    }, 1000);
}

// Função que troca para o próximo nível de blinds
async function trocarNivel(torneio: Torneio, callback: (torneio: Torneio) => void): Promise<void> {
    const blinds = await TorneioBlindItem.findAll({
        where: { torneioId: torneio.id },
        order: [['order', 'ASC']],
    });

    const indiceBlindAtual = blinds.findIndex(b => b.id === torneio.blindItemAtual);

    if (indiceBlindAtual === -1 || indiceBlindAtual >= blinds.length - 1) {
        finalizarTorneio(torneio, callback);
        return;
    }

    const proximoBlind = blinds[indiceBlindAtual + 1];

    if (proximoBlind) {
        torneio.blindItemAtual = proximoBlind.id;
        torneio.tempoRestanteNivel = proximoBlind.duracao * 60;

        await torneio.save();

        // Aqui está a chamada ao callback que deve incluir o próximo nível
        // callback(torneio); // Envia o torneio e o próximo nível
    } else {
        finalizarTorneio(torneio, callback);
    }
}

// Função para finalizar o torneio quando os níveis acabam
async function finalizarTorneio(torneio: Torneio, callback: (torneioAtualizado: Torneio, proximoNivel: TorneioBlindItem | null) => void): Promise<void> {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }

    torneio.status = 'finalizado';
    await Torneio.update({ status: 'finalizado' }, { where: { id: torneio.id } });

    callback(torneio, null); // Passa null para o próximo nível, pois o torneio foi finalizado
}

async function atualizaTorneio() {
    atualizarTorneio = !atualizarTorneio
}

export default {
    iniciarTorneio,
    pararTorneio,
    buscarTorneioEmAndamentoOuParado,
    buscarEEnviarTorneio,
    atualizaTorneio
};
