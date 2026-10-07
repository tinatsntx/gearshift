import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
export const state=sqliteTable("gearshift_state",{id:integer("id").primaryKey(),revision:integer("revision").notNull().default(0),value:text("value").notNull()});
