import { json, route } from "@/lib/handler";
import { userResponse } from "@/services/dto";
import { findAll } from "@/services/users";

export const GET = route(async () => json((await findAll()).map(userResponse)));
