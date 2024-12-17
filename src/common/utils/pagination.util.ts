export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  totalItems: number;
  currentPage: number;
  totalPages: number;
}

export async function paginate<
  T,
  ModelDelegate extends {
    findMany: (args: any) => Promise<T[]>;
    count: (args: any) => Promise<number>;
  },
>(
  model: ModelDelegate,
  paginationOptions: PaginationOptions,
  findManyArgs: Parameters<ModelDelegate['findMany']>[0],
): Promise<PaginatedResult<T>> {
  const { page, limit } = paginationOptions;

  const skip = page ? (page - 1) * limit : undefined;
  const take = limit;

  const results = await model.findMany({
    ...findManyArgs,
    skip,
    take,
  });

  const total = await model.count({
    where: findManyArgs.where,
  });

  const totalPages = limit ? Math.ceil(total / limit) : 1;
  const currentPage = page || 1;

  return {
    data: results,
    totalItems: total,
    currentPage: currentPage,
    totalPages: totalPages,
  };
}
