module.exports = {
  dialect: "mysql",
  host: "localhost",
  // host: "192.168.18.11",
  username: "admin",
  password: "admin",
  database: "ticketJango",
  timezone: "+00:00",
  define: {
    timestamps: true,
    underscored: true,
  },
};

// module.exports = {
//   dialect: "mysql",
//   host: "jango-ingressos.czgc6wkgq9uj.sa-east-1.rds.amazonaws.com",
//   // host: "192.168.18.11",
//   username: "admin",
//   password: "Adamsfo232",
//   database: "ticketJango",
//   timezone: "+00:00",
//   define: {
//     timestamps: true,
//     underscored: true,
//   },
// };
