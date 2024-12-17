export interface GetAllResponse<T> {
  status: string;
  message: string;
  data: T[];
  grandTotal?: {};
  totalItems: number;
  currentPage: number;
  totalPages: number;
}

export interface GetResponse<T> {
  status: string;
  data: T;
}
