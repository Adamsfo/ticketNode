"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistros = getRegistros;
const sequelize_1 = require("sequelize");
// Tipagem genérica para a função `getRegistros`
async function getRegistros(model, req, res, next, includeOptions) {
    try {
        // Pegando os parâmetros de paginação, pesquisa, filtros e ordenação da query string
        const page = parseInt(req.query.page, 10) || 1;
        const pageSize = parseInt(req.query.pageSize, 10) || 10;
        const search = req.query.search || '';
        const order = req.query.order || 'asc';
        const sortBy = req.query.sortBy || 'id';
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        const offset = (page - 1) * pageSize;
        const limit = pageSize;
        const searchCondition = search ? {
            [sequelize_1.Op.or]: Object.keys(model.rawAttributes).map(field => ({
                [field]: { [sequelize_1.Op.like]: `%${search}%` }
            }))
        } : {};
        const filterConditions = {};
        if (filters && typeof filters === 'object') {
            for (const [key, value] of Object.entries(filters)) {
                console.log(key);
                if (key.startsWith('empresaId')) {
                    const ids = typeof value === 'string' ? value.split(',').map(id => parseInt(id.trim(), 10)) : value;
                    if (Array.isArray(ids)) {
                        filterConditions[key] = { [sequelize_1.Op.in]: ids };
                    }
                }
                else {
                    filterConditions[key] = { [sequelize_1.Op.like]: `%${value}%` };
                }
            }
        }
        const whereCondition = {
            ...searchCondition,
            ...filterConditions
        };
        const { count, rows } = await model.findAndCountAll({
            where: whereCondition,
            offset,
            limit,
            order: [[sortBy, order]],
            include: includeOptions || [],
            distinct: true,
        });
        // Flattening the associated data
        const flattenedRows = rows.map(row => {
            const plainRow = row.get({ plain: true });
            if (includeOptions) {
                includeOptions.forEach(option => {
                    const associatedData = plainRow[option.as || ''];
                    if (associatedData) {
                        if (Array.isArray(associatedData)) {
                            // Merge array data into the main object, if the association returns multiple entries
                            associatedData.forEach(assocItem => {
                                Object.keys(assocItem).forEach(key => {
                                    plainRow[`${option.as}_${key}`] = assocItem[key];
                                });
                            });
                        }
                        else {
                            // Merge single associated object data into the main object
                            Object.keys(associatedData).forEach(key => {
                                plainRow[`${option.as}_${key}`] = associatedData[key];
                            });
                        }
                    }
                    else {
                        // Ensure the attribute is present, even if empty or null
                        if (option.attributes) {
                            option.attributes.forEach(attr => {
                                plainRow[`${option.as}_${attr}`] = null; // Or use an appropriate default value
                            });
                        }
                    }
                    delete plainRow[option.as || ''];
                });
            }
            return plainRow;
        });
        const totalPages = Math.ceil(count / pageSize);
        res.status(200).json({
            data: flattenedRows,
            meta: {
                totalItems: count,
                totalPages,
                currentPage: page,
                pageSize
            }
        });
    }
    catch (error) {
        console.error('Error fetching records:', error); // Log detalhado para depuração
        next(error);
    }
}
