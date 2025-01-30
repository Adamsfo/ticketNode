const Sequelize = require('sequelize')
const dbConfig = require('../config/database')
import { EmpresaInit } from '../models/Empresa';
import { UsuarioInit } from '../models/Usuario'
import { CidadeInit } from '../models/Cidade';
// import { VeiculoInit } from '../models/Veiculo';
import { ClienteFornecedorInit } from '../models/ClienteFornecedor';
// import { ContaAPagarInit } from '../models/ContaAPagar';
// import { ContaAReceberInit } from '../models/ContaAReceber';
// import { ContaBancariaInit } from '../models/ContaBancaria';
import { EstruturaTorneioInit } from '../models/EstruturaTorneio';
import { TorneioInit } from '../models/Torneio';
import { TicketInit } from '../models/Ticket';
import { CaixaInit } from '../models/Caixa';
import { PagamentoInit } from '../models/Pagamento';
const ConfigIniciais = require('./ConfigIniciais')
const FuncaoSistema = require('./FuncaoSistema')

const connection = new Sequelize(dbConfig);

(async () => {
  try {
    // Autenticação da conexão
    await connection.authenticate();
    console.log('Conectado no banco de dados!');
    // ContaAPagarInit(connection)
    // ContaAReceberInit(connection)
    // ContaBancariaInit(connection)
    // VeiculoInit(connection)

    // Inicializando modelos    
    EmpresaInit(connection)
    UsuarioInit(connection)
    CidadeInit(connection)

    ClienteFornecedorInit(connection)

    EstruturaTorneioInit(connection)
    TorneioInit(connection)
    PagamentoInit(connection)
    TicketInit(connection)
    CaixaInit(connection)

    // Sincronizando os modelos com o banco de dados        
    await connection.sync();
    // await connection.sync({ alter: true });

    // Executando configurações iniciais
    await FuncaoSistema.funcaoSistema();
    await ConfigIniciais.configUsuario();


  } catch (error) {
    console.error('Banco de dados não conectado:', error);
  }
})();

module.exports = connection;