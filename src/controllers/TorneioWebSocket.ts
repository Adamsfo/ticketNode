import WebSocket from 'ws';
import { Server as HttpServer } from 'http';
import TorneioService from './TorneioService';

let wss: WebSocket.Server | null = null;

// Função para iniciar o servidor WebSocket
export function iniciarServidorWebSocket(server: HttpServer): void {
    try {
        wss = new WebSocket.Server({ server });

        wss.on('connection', (ws: WebSocket) => {
            console.log('Novo cliente conectado');

            // Envia uma mensagem de boas-vindas ao cliente conectado
            // ws.send(JSON.stringify({ message: 'Bem-vindo', status: 'conectado' }));

            // Envia o status inicial do torneio
            TorneioService.buscarEEnviarTorneio();

            // Escuta o fechamento da conexão do cliente
            ws.on('close', () => {
                console.log('Cliente desconectado');
            });
        });

        console.log('Servidor WebSocket iniciado e aguardando conexões');
    } catch (error) {
        console.error('Erro ao iniciar o servidor WebSocket:', error);
    }
}

// Função para enviar atualização do torneio para todos os clientes conectados
export function enviarAtualizacaoTorneio(torneio: any) {
    if (wss) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(torneio));
            }
        });
    }
}
