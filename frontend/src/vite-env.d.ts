/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL base da API. Vazio = mesma origem (`/api`). Defina para apontar a um
  // backend em host/porta separados, ex.: http://192.168.0.50:3001/api
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
