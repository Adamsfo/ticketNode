require('dotenv').config();
import express, { Request, Response } from 'express';
import http from 'http'; // Importa o http para criar um servidor HTTP
const authRoutes = require('./routes/authRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const cidadeRoutes = require('./routes/cidadeRoutes');
const ClienteFornecedorRoutes = require('./routes/clienteFornecedorRoutes');
const empresaRoutes = require('./routes/empresaRoutes');
const enderecoRoutes = require('./routes/enderecoRoutes');
const tipoIngressoRoutes = require('./routes/tipoIngressoRoutes');
const produtorRoutes = require('./routes/produtorRoutes');
import fs from 'fs'

// Inicializa o banco de dados
require('./database/index');
const cors = require('cors');
const fileupload = require('express-fileupload');
var path = require('path');
var publicDir = path.join(__dirname, 'public');
var uploadsDir = path.join(__dirname, 'public/uploads');
const errorHandler = require('./middlewares/errorHandler');

const server = express();

// Middleware
server.use(cors());
server.use(express.json({ limit: '4mb' }));
server.use(express.urlencoded({ extended: true, limit: '4mb' }));
server.use(fileupload());


// Servindo arquivos estáticos
server.use('/', express.static(publicDir));
server.use('/uploads', express.static(uploadsDir));

// Rotas
server.use(authRoutes);
server.use(usuarioRoutes);
server.use(cidadeRoutes);
server.use(ClienteFornecedorRoutes);
server.use(empresaRoutes);
server.use(enderecoRoutes);
server.use(tipoIngressoRoutes);
server.use(produtorRoutes);

// Tratamento de erros
server.use(errorHandler);

// Rota padrão
server.get('/', (req: any, res: any) => {
    res.send('Hello World');
});

// Rota de upload
server.post('/upload', (req: Request, res: Response) => {
    if (!req.body || !req.body.file) {
        return res.status(400).send('No files were uploaded.');
    }

    // O campo "file" deve conter a string em base64
    const base64Data = req.body.file;
    const buffer = Buffer.from(base64Data, 'base64');

    // Mover o arquivo para a pasta desejada
    let filename = "LogoProdutor_" + Date.now() + ".png"
    const uploadPath = path.join(__dirname, '/public/uploads', filename);

    fs.writeFile(uploadPath, new Uint8Array(buffer), (err) => {
        if (err) {
            return res.status(500).send('Error saving file.');
        }

        res.send({ filename: filename });
    });
});

// Inicia o WebSocket
const httpServer = http.createServer(server);

// Define a porta a partir do arquivo de configuração e inicia o servidor
const PORT = process.env.PORT || 9000; // Define a porta padrão como 9000 se não estiver no .env
httpServer.listen(PORT, () => {
    console.log(`Servidor rodando no endereço: ${process.env.BASE || `http://localhost:${PORT}`} e porta ${PORT}`);
});
