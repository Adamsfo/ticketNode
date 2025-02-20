const Sequelize = require('sequelize')
const dbConfig = require('../config/database')
import { EmpresaInit } from '../models/Empresa';
import { UsuarioInit } from '../models/Usuario'
import { CidadeInit } from '../models/Cidade';
import { ClienteFornecedorInit } from '../models/ClienteFornecedor';
import { TipoIngressoInit } from '../models/TipoIngresso';
import { ProdutorInit } from '../models/Produtor';
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
    TipoIngressoInit(connection)
    ProdutorInit(connection)

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