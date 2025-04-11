import { Model, Op, ModelStatic } from 'sequelize';

interface IncludeOptions {
  model: ModelStatic<any>;
  as?: string;
  attributes?: string[];
  include?: IncludeOptions[];
}

// Função para converter de camelCase/UpperCamelCase para snake_case
function convertToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// Tipagem genérica para a função `getRegistros`
export async function getRegistros<T extends Model>(
  model: ModelStatic<T>,
  req: any,
  res: any,
  next: any,
  includeOptions?: IncludeOptions[]
) {
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


    const searchCondition: any = search
      ? {
        [Op.or]: [
          // Condições para os campos das associações
          ...(includeOptions?.map(option => {
            if (option.as) {
              return option.attributes?.map(attr => ({
                [`$${option.as}.${convertToSnakeCase(attr)}$`]: { [Op.like]: `%${search}%` }
              }));
            }
            return null;
          }).flat().filter(Boolean) || []),

          // Condições para os campos da tabela principal
          ...Object.keys(model.rawAttributes)
            .filter(field => {
              const dbField = convertToSnakeCase(field);
              return dbField !== 'created_at' && dbField !== 'updated_at';
            })
            .map(field => ({
              [field]: { [Op.like]: `%${search}%` }
            }))
        ]
      }
      : {};

    const filterConditions: { [key: string]: any } = {};

    if (filters && typeof filters === 'object') {
      for (const [key, value] of Object.entries(filters)) {
        if (key.includes('_')) {
          // Se o nome do filtro contém underline, trata como uma associação
          const [association, field] = key.split('_'); // Ex: "ClienteFornecedor", "razaoSocialNome"

          // Verifica se a associação está em `includeOptions`
          const assocOption = includeOptions?.find(option => option.as === association);
          if (assocOption) {
            const snakeCaseField = convertToSnakeCase(field);
            // Condição de filtro para a associação com a tabela
            // Usamos o formato de $association.field$ para aplicar o filtro corretamente
            filterConditions[`$${association}.${snakeCaseField}$`] = { [Op.like]: `%${value}%` };
          }
        } else {
          // Para filtros normais, não relacionados a associações
          if (key.startsWith('empresaId')) {
            const ids = typeof value === 'string' ? value.split(',').map(id => parseInt(id.trim(), 10)) : value;
            if (Array.isArray(ids)) {
              filterConditions[key] = { [Op.in]: ids };
            }
          } if (key === 'uid') {
            filterConditions[key] = { [Op.eq]: value };
          } else {
            filterConditions[key] = { [Op.like]: `%${value}%` };
          }
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
            } else {
              // Merge single associated object data into the main object
              Object.keys(associatedData).forEach(key => {
                plainRow[`${option.as}_${key}`] = associatedData[key];
              });
            }
          } else {
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
  } catch (error) {
    console.error('Error fetching records:', error); // Log detalhado para depuração
    next(error);
  }
}
