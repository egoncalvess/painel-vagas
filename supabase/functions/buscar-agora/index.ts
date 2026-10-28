// Botão "Buscar vagas agora": confere se quem pediu pode usar o painel e dispara o robô no GitHub.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: ok } = await sb.rpc("permitido");
  if (!ok) return resposta({ erro: "sem acesso" }, 403);
  const r = await fetch(
    `https://api.github.com/repos/${Deno.env.get("PAINEL_REPO")}/actions/workflows/coletar.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + Deno.env.get("PAINEL_GH_TOKEN"),
        Accept: "application/vnd.github+json",
        "User-Agent": "painel-vagas",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  return r.status === 204 ? resposta({ ok: true }) : resposta({ erro: "github " + r.status }, 502);
});
