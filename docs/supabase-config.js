// Configuração opcional do Supabase para o Painel de Vagas / Radar.
// Quando vazio, o sistema usa automaticamente a Base Dinâmica por Pessoa (RadarDynamicDB: IndexedDB + LocalStorage)
// sem exigir Token do GitHub nem backend obrigatório.
window.SUPABASE = window.SUPABASE || { url: "", anon: "" };
