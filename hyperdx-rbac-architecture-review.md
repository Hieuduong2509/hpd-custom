# Review kiến trúc RBAC/Multi-team HyperDX & đánh giá phương án "tool trung gian"

> Review dựa trên source thực tế trong `hyperdx-k8s/hyperdx` (đọc trực tiếp qua device bridge, không suy đoán). Đối chiếu với `hyperdx-rbac-implementation-plan.md` đã có trong repo.

---

## 1. Hiện trạng thực tế so với kế hoạch (Phase 1-4)

Đối chiếu file thật, các phase 1-4 đã được áp dụng **đúng như plan, và đã đi xa hơn plan một chút**:

- `models/user.ts`: đã có `role: 'super_admin' | 'mentor' | 'dev'` (default `dev`) **và thêm một field mới chưa có trong plan gốc**: `allowedServices?: string[]` (default `[]`).
- `models/teamInvite.ts`: đã có `role: 'mentor' | 'dev'`.
- `middleware/roles.ts`: `requireRole()` đúng như plan.
- `middleware/auth.ts`: `isUserAuthenticated` / `validateUserAccessKey` đã gắn thêm `req._hdx_user_role` và `req._hdx_allowed_services` vào mọi request đã auth (session lẫn access-key).
- `controllers/team.ts`: có `createAdditionalTeam(name, mentorEmail)` — khác chút so với plan (plan dùng `TeamInvite` để mời mentor, code thật gán role trực tiếp cho user đã tồn tại sẵn bằng email — nghĩa là **mentor phải tự đăng ký tài khoản trước** rồi super_admin mới "nhận" họ vào team mới, thay vì gửi invite).
- `routers/api/team.ts`: 7 route đã được gắn `requireRole(...)`, đúng theo Phase 4, cộng thêm route mới `POST /admin/teams` (Phase 3) và `PATCH /member/:id` để set role/allowedServices cho member (route này không nằm trong plan gốc — là bổ sung mới).
- Migration `20260824155100-add_role_field.ts`: đã chạy đúng logic set super_admin cho user đầu tiên.

→ Tóm lại: bạn không chỉ làm xong Phase 1-4, mà đã âm thầm mở rộng sang một mô hình phân quyền **2 lớp**: Team (đã có sẵn) + "service" trong-team qua `allowedServices`. Đây là điểm quan trọng cho phần 5 bên dưới.

---

## 2. Các vấn đề phát hiện được khi review toàn bộ source

### 2.1 (CRITICAL) RBAC chỉ áp dụng cho 1 trong 3 "cửa" vào hệ thống

HyperDX có **3 đường vào** cùng dùng chung model User/Team nhưng đi qua 3 middleware auth khác nhau:

| Cửa vào | Middleware auth | File router | Có `requireRole`? |
|---|---|---|---|
| Session (web app) | `isUserAuthenticated` | `routers/api/team.ts` | **Có** (đã sửa Phase 4) |
| External API v2 (Bearer `accessKey`) | `validateUserAccessKey` | `routers/external-api/v2/team.ts` | **KHÔNG** |
| MCP server (Bearer `accessKey`) | `validateUserAccessKey` | `mcp/app.ts` → mcp tools | **KHÔNG** (không có khái niệm role) |

`routers/external-api/v2/team.ts` implement lại gần như y hệt các route của `routers/api/team.ts` (`POST /invitation`, `DELETE /invitation/:id`, `DELETE /member/:id`, `GET /members`...) nhưng **không có một dòng `requireRole` nào**. Mọi user — kể cả role `dev` — đều có sẵn `accessKey` cá nhân (trả về công khai qua `GET /me`), nên chỉ cần gọi:

```
DELETE /api/v2/team/member/<id_cua_mentor>
Authorization: Bearer <accessKey của chính dev đó>
```

là xoá được thành viên khác trong team, hoặc `POST /api/v2/team/invitation` để tự mời thêm người — **hoàn toàn vô hiệu hoá RBAC vừa làm ở Phase 2/4**, vì logic phân quyền được cắm vào router thay vì vào tầng dữ liệu/service dùng chung.

→ Đây là lỗ hổng nghiêm trọng nhất tìm được, cần vá trước khi lên production, không liên quan gì tới câu hỏi "tool trung gian" — vá ngay trong code hiện tại (thêm gate role vào `external-api/v2/team.ts` hoặc chặn hẳn các route ghi ở External API v2 nếu chỉ dùng nội bộ).

### 2.2 (HIGH) Route accept-invite chưa gán role — đúng như plan gốc đã cảnh báo nhưng chưa fix

`routers/api/root.ts`, route `POST /team/setup/:token` (dòng 156-162), khi tạo user mới từ token invite:

```ts
(User as any).register(
  new User({
    email: teamInvite.email,
    name: teamInvite.email,
    team: teamInvite.teamId,
  }),
  password,
  ...
);
```

Field `role` **không được truyền**, nên Mongoose luôn áp default schema là `'dev'` — bất kể `teamInvite.role` là `'mentor'` hay `'dev'`. Đây chính xác là đoạn mà `hyperdx-rbac-implementation-plan.md` (Phase 4) đã ghi rõ cần sửa, nhưng đối chiếu code thật thì **chưa được áp dụng**. Hệ quả: hiện tại không có cách nào mời được một mentor thứ 2 qua flow invite bình thường — họ sẽ luôn vào team với role `dev`.

### 2.3 (MEDIUM) `allowedServices` là "dead code" — chưa có enforcement ở đâu cả

Đã grep toàn bộ `packages/api/src` (bao gồm `clickhouse-proxy`, `dashboards`, `sources`, `saved-search`, `alerts`, `external-api/v2/*`, toàn bộ `mcp/tools/*`, `tasks/checkAlerts/*`): `allowedServices` / `_hdx_allowed_services` chỉ xuất hiện ở nơi **ghi/đọc field**, không có bất kỳ nơi nào dùng nó để **lọc dữ liệu trả về**.

Nói cách khác: field đã có, API set/get đã có, nhưng yêu cầu gốc số 3 ("dev chỉ thấy dashboard/log/trace của service mình") **chưa được thực thi** — một dev hiện tại vẫn thấy toàn bộ dashboard/source/log/trace của cả team, bất kể `allowedServices` chứa gì. Cần làm rõ đây là việc đang dang dở (chưa tới Phase 5 thật) chứ không phải bug — nhưng nó thay đổi hẳn cách trả lời câu hỏi ở phần 3, vì đây chính là phần khó nhất.

### 2.4 (LOW, đã biết) `user.team` là field đơn

Đúng như plan gốc đã note: 1 mentor chỉ quản được 1 team. Không phải vấn đề mới, chỉ nhắc lại vì liên quan tới thiết kế ở phần 3.

---

## 3. Trả lời câu hỏi chính: có thể tách RBAC ra "tool trung gian" (factory/adapter) để giảm xung đột khi merge upstream?

**Trả lời ngắn: được một phần lớn — đủ để giảm mạnh diện tích code fork — nhưng không thể tách 100%.** Lý do khác nhau tuỳ theo 3 yêu cầu gốc, vì chúng nằm ở 3 tầng khác nhau của hệ thống.

### 3.1 Yêu cầu 2 (API key riêng theo team) — gần như không cần đụng core

HyperDX **upstream đã có sẵn** `team.apiKey`, `getTeamByApiKey()`, `collectorAuthenticationEnforced` — đây là cơ chế multi-tenant ingestion gốc, không phải thứ bạn thêm vào. Cái duy nhất bị khoá là "chỉ tạo được 1 Team" (`isTeamExisting()`). Vì vậy phần này **vốn đã gần như không cần fork gì cả** nếu bạn không cần một API tự-phục-vụ để tạo team:

- Có thể tạo team mới bằng một **script ngoài** (ts-node/CLI) gọi trực tiếp MongoDB driver, hoàn toàn nằm ngoài `packages/api` — insert `Team` doc + gọi lại `setupTeamDefaults()` (hàm này export sẵn, dùng như thư viện chứ không sửa nó). Không đụng 1 dòng route/controller nào.
- Bạn đã chọn cách làm route `POST /admin/teams` để tự-phục-vụ qua UI/Postman — hợp lý nếu cần vận hành thường xuyên, nhưng đó là lựa chọn UX, không phải yêu cầu bắt buộc phải sửa core.

→ Không cần "tool trung gian" cho phần này — nó native sẵn.

### 3.2 Yêu cầu 1 (RBAC cho hành động quản trị: mời người, rotate key, xoá member...) — tách ra ngoài được, và **nên** tách

Đây là phần hợp với ý tưởng "tool trung gian / factory" nhất, vì bản chất là một bảng tra cứu tĩnh: **(method, path-pattern) → role được phép**. Có 2 cách triển khai, từ nhẹ tới nặng:

**Cách A — Gateway độc lập đứng trước toàn bộ `app` container (khuyến nghị).**
Vì đây là repo `hyperdx-k8s`, điểm neo tự nhiên là tầng Ingress/reverse-proxy trước khi traffic tới container `app`. Viết một service nhỏ (Node/Express, hoặc dùng OPA/Envoy nếu muốn chuẩn hơn) làm việc sau:
1. Đọc session cookie hoặc header `Authorization: Bearer <accessKey>`.
2. Tra thẳng MongoDB (cùng `MONGO_URI`, không qua code HyperDX) — với session: đọc collection `sessions` (MongoStore) lấy `userId`, rồi đọc `users` lấy `role`/`team`; với access-key: đọc `users` theo `accessKey`.
3. Match `req.method + req.path` với một bảng rule bạn tự định nghĩa (file JSON/YAML do bạn sở hữu 100%), ví dụ:
   ```yaml
   - { methods: [POST], path: "/team/invitation", roles: [super_admin, mentor] }
   - { methods: [PATCH], path: "/team/apiKey", roles: [super_admin, mentor] }
   - { methods: [POST], path: "/admin/teams", roles: [super_admin] }
   - { methods: [DELETE], path: "/api/v2/team/member/*", roles: [super_admin, mentor] }
   - { methods: [POST], path: "/api/v2/team/invitation", roles: [super_admin, mentor] }
   ```
4. Nếu role không đủ → trả 403 ngay tại gateway, request **không bao giờ tới** container `app`.

Điểm mạnh chính là nó gate **cả 3 cửa vào cùng lúc** (session API, External API v2, và có thể cả MCP nếu muốn) bằng **một chỗ duy nhất**, giải quyết luôn lỗ hổng 2.1 ở trên — thứ mà cách làm hiện tại (rải `requireRole()` vào từng router file) không làm được, vì mỗi router file là một điểm fork riêng và dễ quên áp dụng lại khi thêm entry point mới.

Khi upstream ra bản mới: bạn chỉ merge code app bình thường (không có `requireRole()` nào trong diff của bạn nữa để phải resolve), và chỉ cần **thêm 1 dòng vào bảng rule YAML** nếu upstream thêm một route quản trị nhạy cảm mới. Diff giữa fork và upstream ở các file router gần như bằng 0.

**Cách B — Middleware tập trung ngay trong `api-app.ts` (nhẹ hơn, ít hạ tầng hơn, nhưng vẫn đụng 1 file core).**
Nếu không muốn thêm một service hạ tầng mới, có thể giữ logic RBAC trong process nhưng **gom về đúng 1 điểm neo** là nơi mount router (`api-app.ts`, dòng 100-115) thay vì rải vào từng file router:
```ts
app.use('/team', isUserAuthenticated, rbacGate('/team'), routers.teamRouter);
app.use('/api/v2/team', isUserAuthenticated, rbacGate('/api/v2/team'), externalTeamRouter);
```
với `rbacGate()` là middleware bạn viết trong file mới hoàn toàn (`middleware/rbacGate.ts`), tự tra bảng rule tĩnh theo `method+subpath`. Diff vào core lúc này thu hẹp lại **chỉ còn vài dòng ở `api-app.ts`**, thay vì hàng chục dòng rải trong `team.ts` + toàn bộ `external-api/v2/team.ts` không được gate như hiện tại. Đây cũng vá luôn lỗ hổng 2.1.

### 3.3 Yêu cầu 3 (dev chỉ thấy đúng service/team của mình) — **không thể tách hết ra ngoài**, phải chọn 1 trong 2 hướng

Đây là phần quan trọng nhất phải nói rõ, vì nó quyết định mức độ "sạch" bạn có thể đạt được:

- **Nếu "service" ≡ "Team"** (mỗi service/microservice là 1 Team riêng, đúng như Phase 1-5 gốc thiết kế): yêu cầu 3 được thoả **miễn phí, 0% code core**, vì toàn bộ controller hiện tại (`dashboard.ts`, `sources.ts`, `connection.ts`, `savedSearch.ts`, `alerts.ts`, clickhouse-proxy...) đã filter `team: teamId` sẵn ở tầng MongoDB — đây là kiến trúc multi-tenant gốc của HyperDX, không phải thứ bạn thêm vào. Không có gì để tách ra "tool trung gian" vì nó không phải logic bạn viết.

- **Nếu "service" là khái niệm nhỏ hơn Team** (nhiều service trong 1 team, dev chỉ được xem 1 phần dashboard/source trong team mình — đúng như `allowedServices` bạn đã bắt đầu xây ở mục 2.3): đây **buộc phải sửa sâu vào code đọc dữ liệu**, vì:
  - `clickhouse-proxy` forward thẳng câu SQL/query ClickHouse do frontend build sẵn — muốn lọc theo service, phải can thiệp vào chỗ **xây câu query** (thêm điều kiện `WHERE ServiceName IN (...)`), tức đúng những file vừa bị bạn sửa gần đây (`clickhouseProxy.ts`, `mcp/tools/query/helpers.ts`, `external-api/v2/search.ts`, `checkAlerts/providers/default.ts`). Một gateway đứng ngoài **không đọc được** ngữ nghĩa của một câu ClickHouse SQL tuỳ ý để biết dòng nào "thuộc service nào" — việc lọc response ở tầng network chỉ khả thi với JSON có cấu trúc cố định (dashboard, source, saved-search), không khả thi với query engine mở.
  - Muốn làm đúng và bền, cách sạch nhất **vẫn nằm trong core** nhưng nên làm ở ClickHouse thay vì ở tầng ứng dụng: mỗi "service" là 1 ClickHouse database/user riêng (đúng ý tưởng Phase 3.5 trong plan gốc, đang dùng cho GCP), và mapping Source/Connection theo service — tức là lại quay về mô hình "service ≈ 1 đơn vị multi-tenant", chỉ khác là đơn vị đó nằm dưới Team một cấp.

→ Khuyến nghị: **bỏ hướng `allowedServices`** (đang là dead code, và nếu enforce sẽ buộc sửa sâu 5-6 file lõi thường xuyên đổi theo mỗi bản upstream — đúng rủi ro bạn đang lo). Thay vào đó, dùng lại đúng mô hình Team-per-service mà Phase 1-5 gốc đã thiết kế: mỗi service = 1 Team = 1 API key = 1 bộ Connection/Source riêng. Nếu sau này thật sự cần nhiều service trong 1 team, hãy tạo nhiều Team con và cho mentor có quyền trên nhiều Team (đổi `user.team` từ ObjectId đơn sang mảng — plan gốc đã note ở phần rủi ro) **hơn là cố lọc dữ liệu theo tag trong cùng 1 Team.**

---

## 4. Kiến trúc đề xuất (tổng hợp)

```
                         ┌─────────────────────────────┐
   Browser / Postman /   │      RBAC Gateway (mới)      │   ─ sở hữu 100% bởi bạn
   External API client   │  - đọc session/accessKey      │   ─ không có dòng nào
   ──────────────────►   │  - tra role trực tiếp Mongo    │     của HyperDX trong đây
                         │  - match rule table tĩnh       │
                         │  - 403 nếu sai role            │
                         └───────────────┬─────────────┘
                                         │ pass-through nếu OK
                                         ▼
                         ┌─────────────────────────────┐
                         │   HyperDX app container      │   ─ core, gần như KHÔNG fork
                         │   (giữ nguyên upstream +      │     ngoại trừ 2 điểm neo nhỏ:
                         │    2 điểm neo tối thiểu)       │     1) role field trên User (side-
                         └─────────────────────────────┘        collection nếu muốn né cả
                                                                  models/user.ts)
                                                                2) gán role khi accept-invite
                                                                  (root.ts, không tránh được)
```

Diện tích code fork còn lại sau khi áp dụng, so với hiện tại:

| Thành phần | Hiện tại | Sau khi tách |
|---|---|---|
| `middleware/roles.ts` | file mới | giữ, chuyển logic vào gateway hoặc rbacGate |
| `routers/api/team.ts` | 7 chỗ chèn `requireRole` rải rác | 0 — trả về gần nguyên bản upstream |
| `routers/external-api/v2/team.ts` | 0 (đây là lỗ hổng) | 0 — được gate ở gateway, không cần sửa file |
| `models/user.ts` | field `role`, `allowedServices` | tuỳ chọn: giữ (đơn giản hơn) hoặc chuyển ra collection `UserRoleExt` riêng (né hẳn diff vào file này — Mongoose cho phép `mongoose.model('User').schema.post('save', ...)` từ file khác, không cần sửa `models/user.ts`) |
| `models/teamInvite.ts` | field `role` | tương tự, có thể để 1 collection phụ tra theo `teamId+email` |
| `routers/api/root.ts` | chưa sửa (bug 2.2) | **buộc phải sửa 1 dòng** — điểm duy nhất không né được, vì đây là nơi duy nhất user được tạo từ invite; nên đánh dấu rõ bằng comment marker để dễ tái áp dụng sau mỗi lần rebase |
| `allowedServices` + enforcement ở query layer | dead code, nếu làm tiếp sẽ lan ra 5-6 file lõi (clickhouse-proxy, mcp/query, external-api search/charts, checkAlerts) | **bỏ**, thay bằng Team-per-service |

Với bảng trên, điểm neo bắt buộc phải chạm vào core chỉ còn **1 route (`root.ts`, ~3 dòng)** — mọi thứ khác đẩy được ra gateway hoặc side-collection. Đây gần với tinh thần "factory/adapter" bạn muốn: khi upstream ra bản mới, việc của bạn chỉ là (1) merge bình thường, (2) re-áp lại đúng 1 đoạn patch nhỏ ở `root.ts` nếu file đó đổi, (3) cập nhật rule table nếu upstream thêm route quản trị mới — không phải resolve conflict rải rác trên 6-7 file như hiện tại.

---

## 5. Việc cần làm tiếp theo (đề xuất thứ tự)

1. **Vá ngay** lỗ hổng 2.1 (External API v2 team router không có RBAC) — đây là bug bảo mật, độc lập với quyết định kiến trúc gateway.
2. **Vá ngay** lỗ hổng 2.2 (`root.ts` thiếu `role: teamInvite.role`) — 1 dòng.
3. Quyết định: giữ `allowedServices` (và chấp nhận sửa sâu core, chịu rủi ro merge) hay bỏ nó và dùng lại Team-per-service thuần (khuyến nghị).
4. Nếu đồng ý hướng gateway: mình có thể thiết kế chi tiết + code mẫu cho gateway (Cách A) hoặc `rbacGate` middleware tập trung (Cách B) ở lượt làm tiếp theo — đây là quyết định ảnh hưởng hạ tầng (thêm 1 service mới trong k8s manifest) nên nên chốt hướng trước khi mình viết code.
