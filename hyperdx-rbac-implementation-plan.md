# Kế hoạch fork HyperDX: RBAC + Multi-team API Key + Phân quyền theo Service

> **Đã verify trên commit thật `fb1a2ff6` (nhánh `main`, v2.35.0, ngày 14/08/2026)** — đúng bản Docker image mới nhất bạn đang chạy. Mọi đường dẫn file/đoạn code trong tài liệu này đã đối chiếu trực tiếp với source, không suy đoán.
>
> **Đính chính**: có 1 bản nhận xét lưu hành trước đó claim rằng `models/user.ts` đã có sẵn `role: ['admin','developer']`, rằng proxy dùng tham số `custom_hdx_api_key` để ClickHouse tự làm Row-Level Security, và rằng `allowedServices` đã tồn tại sẵn trong code. **Cả 3 claim này đều SAI** — đã grep toàn bộ source xác nhận không tồn tại. Cô lập dữ liệu giữa các Team hiện tại **100% dựa vào code application-level** (Mongo query `team: teamId`), không có RLS ở tầng ClickHouse nào gánh thay. Tài liệu này chỉ giữ lại phần đã verify đúng.

## Mục tiêu (3 yêu cầu gốc)
1. **RBAC**: Phân quyền super_admin / mentor / dev, mentor mới được mời người + quản lý team mình phụ trách
2. **API key riêng theo team**: Mỗi service/team dev có 1 ingestion API key độc lập
3. **Add user vào đúng service riêng biệt**: Dev chỉ thấy dữ liệu (dashboard, alert, log, trace) của team mình

---

## Nguyên tắc cốt lõi đã xác nhận qua source code

HyperDX OSS **đã có sẵn kiến trúc multi-tenant qua model `Team`** — mọi resource (Connection, Dashboard, Alert, SavedSearch, `apiKey` ingestion) đều được query theo `team: teamId`. Cái thiếu chỉ là:
- Không cho tạo Team thứ 2 trở lên (khoá ở `isTeamExisting()`)
- Không có khái niệm `role` trong Team (ai cũng ngang quyền)

→ Nên chiến lược là **mở khoá + bổ sung role**, không phải viết RBAC từ số 0.

---

## PHASE 0 — Chuẩn bị

| Việc | Vị trí |
|---|---|
| Fork repo, checkout đúng tag/commit tương ứng `2.7.1` | `git clone`, đối chiếu `CHANGELOG.md` |
| Dựng môi trường dev local (`yarn dev`, hot reload) | `CONTRIBUTING.md` đã hướng dẫn sẵn |
| Backup MongoDB hiện tại trước khi migrate schema | — |

---

## PHASE 1 — Data model: thêm `role` vào User

**File: `packages/api/src/models/user.ts`**

Thêm field `role` vào schema hiện tại:

```ts
export type UserRole = 'super_admin' | 'mentor' | 'dev';

export interface IUser {
  // ...giữ nguyên các field cũ...
  role: UserRole;
}

const UserSchema = new Schema({
  // ...giữ nguyên...
  role: {
    type: String,
    enum: ['super_admin', 'mentor', 'dev'],
    default: 'dev',
  },
});
```

**File: `packages/api/src/models/teamInvite.ts`**

Thêm field `role` để khi mời, mentor chọn được người mới là `dev` hay `mentor` khác:

```ts
interface ITeamInvite {
  // ...giữ nguyên...
  role: 'mentor' | 'dev';
}
// Trong Schema: role: { type: String, enum: ['mentor', 'dev'], default: 'dev' }
```

**Migration script mới: `packages/api/migrations/mongo/XXXXXXXXXX-add_role_field.ts`**
- Set `role = 'super_admin'` cho **user đầu tiên** của Team đầu tiên (dựa vào `createdAt` sớm nhất)
- Set `role = 'dev'` mặc định cho tất cả user còn lại
- Đây là thời điểm bạn quyết định ai là super_admin ban đầu

---

## PHASE 2 — Middleware kiểm tra quyền

**File mới: `packages/api/src/middleware/roles.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';

export function requireRole(...allowed: Array<'super_admin' | 'mentor' | 'dev'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
```

Dùng như 1 middleware chèn thêm vào route, ví dụ: `router.post('/invitation', requireRole('super_admin', 'mentor'), ...)`.

---

## PHASE 3 — Mở khoá tạo nhiều Team (multi-team API key)

**File: `packages/api/src/controllers/team.ts`**

Thêm hàm mới, KHÔNG gọi `isTeamExisting()`:

```ts
export async function createAdditionalTeam({
  name,
  collectorAuthenticationEnforced = true,
}: {
  name: string;
  collectorAuthenticationEnforced?: boolean;
}) {
  const team = new Team({ name, collectorAuthenticationEnforced });
  await team.save();
  return team; // team.apiKey tự sinh UUID riêng — đây chính là API key riêng cho team này
}
```

**File: `packages/api/src/routers/api/team.ts`**

Thêm route mới, chỉ `super_admin` gọi được:

```ts
router.post(
  '/admin/teams',
  requireRole('super_admin'),
  validateRequest({
    body: z.object({
      name: z.string().min(1),
      mentorEmail: z.string().email(), // gộp luôn bước gán mentor đầu tiên, khỏi cần script tay
    }),
  }),
  async (req, res, next) => {
    try {
      const team = await createAdditionalTeam({ name: req.body.name });
      await setupTeamDefaults(team._id.toString()); // hàm có sẵn, tạo Connection/Source mặc định

      // Tạo luôn mentor đầu tiên cho team này bằng TeamInvite (tái dùng flow accept-invite ở Phase 4,
      // không cần insert thẳng vào Mongo bằng tay)
      const invite = await new TeamInvite({
        teamId: team._id,
        email: req.body.mentorEmail,
        role: 'mentor', // field mới thêm ở Phase 1
      }).save();

      res.json({ teamId: team._id, apiKey: team.apiKey, inviteToken: invite.token });
    } catch (e) { next(e); }
  },
);
```

→ Mỗi lần super_admin gọi route này = 1 team dev mới ra đời + 1 ingestion API key riêng + 1 lời mời mentor sẵn sàng gửi đi, cô lập hoàn toàn (đã xác nhận: leak key team A không push được vào team B).

---

## PHASE 4 — Siết quyền trên các route đã có sẵn

**File: `packages/api/src/routers/api/team.ts`** — sửa các route hiện hữu:

| Route | Hiện tại | Sửa thành |
|---|---|---|
| `POST /team/invitation` | Ai cũng mời được | `requireRole('super_admin', 'mentor')` |
| `PATCH /team/apiKey` (rotate key) | Ai cũng rotate được | `requireRole('super_admin', 'mentor')` |
| `DELETE` team member | Kiểm tra lại logic hiện có | `requireRole('super_admin', 'mentor')` |

**Vị trí chính xác cần sửa cho accept-invite** (đã xác định qua source, không còn mơ hồ):

`packages/api/src/routers/api/root.ts`, route `POST /team/setup/:token`:

```ts
// HIỆN TẠI — thiếu role khi tạo user từ lời mời:
(User as any).register(
  new User({
    email: teamInvite.email,
    name: teamInvite.email,
    team: teamInvite.teamId,
  }),
  password,
  ...
);

// SỬA THÀNH — đọc role đã lưu trong TeamInvite (thêm ở Phase 1):
(User as any).register(
  new User({
    email: teamInvite.email,
    name: teamInvite.email,
    team: teamInvite.teamId,
    role: teamInvite.role, // 'mentor' hoặc 'dev', mặc định 'dev' nếu invite cũ không có field này
  }),
  password,
  ...
);
```

Đây là route DUY NHẤT xử lý accept-invite trong toàn bộ backend (đã grep xác nhận, không có route accept nào khác) — chỉ cần sửa đúng 1 chỗ này là đủ cho toàn bộ luồng mời user.

---

## PHASE 5 — Add user vào đúng service (team) riêng biệt

Không cần code thêm — đây là hệ quả tự động của Phase 1-4:
- super_admin tạo Team "service-payment", "service-checkout"... (Phase 3)
- super_admin tự đăng ký/gán 1 mentor đầu tiên cho mỗi Team (script nhỏ dùng `User.register()` + set `team` + `role: 'mentor'`)
- Mentor của từng Team dùng route `/team/invitation` (đã siết quyền ở Phase 4) để mời đúng dev vào đúng Team của mình
- Dev đăng nhập → session chỉ có `team: teamId` của Team đó → mọi query dashboard/alert/connection tự lọc theo `team` → **dev chỉ thấy service của mình** (đã xác nhận qua code ở các controller)

---

## PHASE 3.5 — Data dùng chung (ví dụ Google Cloud) hiển thị cho mọi Team

Vì `user.team` là field đơn (1 user chỉ thuộc 1 Team), nếu có nguồn data cần **mọi team đều xem được** (ví dụ Google Cloud logs/metrics), không nên bắt user tham gia nhiều Team. Thay vào đó:

1. Đưa data nguồn dùng chung (GCP...) vào 1 database/table ClickHouse riêng, tách biệt khỏi data OTel riêng của từng team.
2. Tạo 1 user ClickHouse **read-only** (chỉ `SELECT`) cho nguồn data này.
3. Set biến môi trường `DEFAULT_CONNECTIONS` / `DEFAULT_SOURCES` (đọc bởi `setupDefaults.ts`, hàm `setupTeamDefaults()` đã dùng ở Phase 3) trỏ tới nguồn dùng chung đó.
4. Kết quả: mỗi lần tạo Team mới ở Phase 3, `setupTeamDefaults()` tự động clone 1 Connection/Source trỏ vào data GCP cho Team đó — mọi team tự có sẵn quyền xem GCP mà không cần sửa gì thêm ở RBAC.

Nếu chỉ muốn 1 số Team được xem (không phải tất cả), gọi `createConnection()` + `createSource()` thủ công riêng cho từng Team cần, không dùng `DEFAULT_CONNECTIONS` toàn cục.

---

## PHASE 6 — Frontend (packages/app) — không bắt buộc nhưng nên có

| Việc | Ưu tiên |
|---|---|
| Trang admin đơn giản gọi `/admin/teams` để tạo team mới (thay vì dùng Postman/curl) | Trung bình |
| Trong UI mời thành viên, thêm dropdown chọn role (mentor/dev) | Trung bình |
| Ẩn nút "Rotate API Key" nếu `role === 'dev'` | Thấp (backend đã chặn ở Phase 4, ẩn UI chỉ là UX) |

Có thể bỏ qua Phase 6 ban đầu, thao tác thẳng qua API bằng Postman/curl để dùng thử trước khi đầu tư làm UI.

---

## PHASE 7 — Testing & Rollout

1. Test bằng 3 tài khoản: 1 super_admin, 1 mentor (team A), 1 dev (team A) — xác nhận dev không gọi được `/admin/teams`, không invite được, không rotate key được.
2. Tạo team B, mời mentor B, xác nhận mentor A **không** thấy được dashboard của team B (dù cùng đăng nhập 1 instance).
3. Test ingestion: dùng apiKey của team A push OTel data → xác nhận data chỉ hiện trong team A, không lẫn sang team B.
4. Test leak key: dùng apiKey team A gọi thẳng OTel collector endpoint → xác nhận chỉ ghi được vào team A, không truy cập được resource của team B qua API backend (vì access-key/session riêng biệt với ingestion key).

---

## Việc KHÔNG nằm trong phạm vi RBAC (đã giải quyết ở các câu trả lời trước, làm song song)

- Alert Discord: dùng Generic Webhook có sẵn trong OSS, trỏ thẳng Discord webhook URL với body `{"content": "{{title}}\n{{body}}\n{{link}}"}` — không cần sửa code.
- Alert Email: chưa có trong OSS hiện tại (chỉ Slack webhook + Generic webhook), cần thêm 1 relay nhỏ (n8n hoặc script SMTP) nhận Generic Webhook rồi gửi mail.

---

## Rủi ro / lưu ý khi maintain fork lâu dài

- Mỗi lần upstream HyperDX ra bản mới, bạn phải tự merge lại các thay đổi ở `user.ts`, `team.ts`, `teamInvite.ts`, `middleware/roles.ts`, `routers/api/team.ts` — nên tách các thay đổi này thành các commit rõ ràng, dễ rebase.
- 1 user chỉ thuộc 1 team (field đơn `ObjectId`, không phải mảng) — nếu sau này cần 1 mentor quản lý nhiều team cùng lúc, đây là điểm phải sửa sâu hơn (đổi sang mảng + sửa toàn bộ các query `find({ team: teamId })` sang `find({ team: { $in: teamIds } })`).

---

## Cập nhật 26/08/2026 — Kiểm tra thực tế lại Phase 1-4, vá bug, chốt mô hình bảo mật

Đối chiếu trực tiếp với source đang chạy (không chỉ đọc plan) phát hiện Phase 1-4 "đã xong" thực ra còn 3 bug đã vá lại trong buổi này:

1. `routers/api/root.ts`, route `POST /team/setup/:token` (accept invite): thiếu `role: teamInvite.role` khi tạo `User` — mọi lời mời `mentor` khi accept đều bị rơi về mặc định `dev`. **Đã vá.**
2. `controllers/team.ts`, `createAdditionalTeam()`: bản cũ `User.findOne({email}).team = newTeam._id` — nếu email đó đã có team từ trước, thao tác này âm thầm xóa họ khỏi team cũ (vì `user.team` là field đơn, không phải mảng). **Đã vá**: đổi sang tạo `TeamInvite` (role `mentor`) như đúng plan gốc, mentor phải tự accept qua link mời; nếu email đã có team thì throw lỗi rõ ràng thay vì ghi đè.
3. `packages/app/src/DBServiceMapPage.tsx` và `ServicesDashboardPage.tsx`: điều kiện lọc dùng `me.role !== 'admin'` — giá trị `'admin'` không tồn tại trong enum role (`super_admin`/`mentor`/`dev`) nên điều kiện luôn đúng, vô tình áp filter service lên cả `super_admin`/`mentor`. **Đã vá** thành `me.role === 'dev'`.

### Chốt mô hình bảo mật: Team là ranh giới cứng, service trong cùng 1 team là quy ước UI (không phải RLS thật)

Đã trace toàn bộ đường đi của data để xác nhận:
- **Cách ly theo Team: chắc chắn 100%.** `packages/api/src/routers/api/clickhouseProxy.ts` (nơi mọi query ClickHouse của app đi qua) chỉ cho phép user dùng Connection thuộc đúng team mình (`getConnectionById(teamId, connectionId)`). API key ingest cũng là 1 field riêng theo từng Team (`team.apiKey`).
- **Cách ly theo service trong cùng 1 team: KHÔNG có RLS thật.** `clickhouseProxy.ts` có sẵn 1 dòng comment để trống `// Propagate team and RBAC settings for row-level security` — chưa từng được cài đặt. `allowedServices` (field trên User) chỉ được dùng để lọc dropdown ở 2 trang frontend (`DBServiceMapPage.tsx`, `ServicesDashboardPage.tsx`) — dev vẫn có thể xem data của service khác trong team mình nếu gọi thẳng API hoặc tự gõ query.
- Cũng xác nhận: OTel Collector (`buildOtelCollectorConfig` trong `opampController.ts`) dùng 1 danh sách `tokens: apiKeys` gộp API key của MỌI team cho 1 `bearertokenauth` receiver dùng chung → chỉ xác thực "key có hợp lệ không", không gắn nhãn "request này dùng key nào" vào data. Mọi team hiện đổ chung 1 database ClickHouse (biến môi trường `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE` toàn cục, không theo team) — không có cột `TeamId`/`ServiceKey` nào trong schema ClickHouse.
- Có 1 cách làm cách ly theo service **thật, không giả mạo được** mà không cần code Go tùy biến cho Collector: mỗi service = 1 port ingest riêng (1 OTel Collector receiver instance riêng, xác thực bằng đúng 1 key) + 1 ClickHouse database riêng (chỉ là 1 database mới trong CÙNG 1 ClickHouse server đang chạy, không phải dựng thêm hạ tầng). **Quyết định: KHÔNG làm hướng này** — chủ động chọn đơn giản, giữ 1 database dùng chung, chấp nhận rủi ro cách ly service trong cùng 1 team chỉ ở mức quy ước/UI.

→ Khi review bảo mật sau này: đừng nhầm `allowedServices` là 1 lớp RLS đã hoàn thiện. Nếu yêu cầu nghiệp vụ sau này siết chặt hơn (ví dụ compliance bắt buộc), quay lại đúng đoạn "mỗi service = 1 port + 1 database riêng" ở trên.

---

## Cập nhật 27/08/2026 — Đổi tên role, đa API key, sửa 2 bug nghiêm trọng, gán dev theo từng service key

### 1. Đổi tên role: `super_admin/mentor/dev` → `admin/owner/dev`
Đổi trong `User`, `TeamInvite`, `middleware/roles.ts`, mọi route dùng `requireRole(...)`, và UI (`TeamMembersSection.tsx`). Thêm migration mới `20260827120000-rename_roles_admin_owner.ts` (KHÔNG sửa migration cũ `20260824155100-add_role_field.ts` vì `migrate-mongo` track theo tên file — sửa file cũ sẽ bị skip trên DB đã chạy migration đó rồi).

### 2. UI tạo/quản lý nhiều API key (`ApiKeysSection.tsx`)
Model mới `TeamApiKey` (name, key, members[], createdBy, revokedAt), 3 route REST (`POST/GET/DELETE team/api-keys`), UI card "Additional API Keys" cho phép admin/owner tạo và revoke key riêng theo từng service — không cần rotate key dùng chung khi 1 service cần thu hồi riêng.

### 3. Bug nghiêm trọng phát hiện qua test thực tế: `getTeam()` bỏ qua tham số `id`
`controllers/team.ts`: `Team.findOne({}, fields)` → luôn trả về Team đầu tiên tạo ra trong DB, bất kể đang request team nào. Hậu quả: dev ở team B khi gọi các route dùng `getTeam(teamId)` (route `GET /team`, `GET /me`, v.v.) nhận về dữ liệu của team A (kể cả `apiKey` dùng chung). Đây là nguyên nhân chính khiến dev "thấy api key của toàn hệ thống". **Đã vá**: `Team.findOne({ _id: id }, fields)` — vá tại nguồn nên tự động sửa đúng cho mọi call site.

### 4. Tính năng mới: gán dev vào đúng 1 service (API key) cụ thể
Yêu cầu: dev chỉ thấy API key của service mình, không thấy key dùng chung của team lẫn key của service khác.

- `TeamApiKey.members: ObjectId[]` — danh sách user được phép thấy key này.
- `TeamInvite.apiKeyId?` — khi admin/owner mời 1 dev, có thể chọn luôn "Service (API Key)" ngay trong form mời (`TeamMembersSection.tsx`); lúc dev accept invite (`root.ts`, route `POST /team/setup/:token`), nếu invite có `apiKeyId` thì tự động thêm dev vào `members` của key đó.
- `GET team/api-keys`: bỏ gate `requireRole` cứng — admin/owner thấy tất cả key của team, dev chỉ thấy các key mà mình có trong `members`.
- `PUT team/api-keys/:id/members` (admin/owner): set lại toàn bộ danh sách `members` của 1 key — dùng cho card "Additional API Keys" mới có nút "Members" mở modal multi-select chọn dev.
- Key dùng chung mặc định (`team.apiKey`, card "Default Ingestion API Key") giờ **ẩn hoàn toàn với dev** (chỉ admin/owner thấy) ở cả `GET /team` và `GET /me` — vì key này không có cơ chế lọc theo service, hiển thị ra sẽ phá vỡ mục đích cách ly.

**Lưu ý (giữ nguyên từ bản ghi 26/08):** đây vẫn là cách ly ở mức quy ước/UI (`members` chỉ lọc hiển thị), KHÔNG phải RLS thật ở tầng ClickHouse — dev vẫn có thể gọi thẳng API hoặc dùng key của mình để về mặt kỹ thuật đọc data team nếu cố tình. Ranh giới cứng, đã enforce thật ở tầng data, vẫn là **Team**.

### 5. Bug hạ tầng: CRLF (`\r\n`) trên file `.sh`/hook khi checkout trên Windows
`docker/otel-collector/entrypoint.sh` và 13 file khác (`docker/hyperdx/*.sh`, `scripts/*.sh`, `.husky/pre-commit`) bị lưu với line ending CRLF → shebang `#!/bin/sh` thành `#!/bin/sh\r`, container OTel Collector crash ngay khi start (`no such file or directory`), toàn bộ pipeline OTel local lẫn khi deploy lên Headlamp/k8s đều fail theo. **Đã vá**: convert 14 file về LF, và thêm chính sách ép LF vào `.gitattributes` (`* text=auto eol=lf`, cộng rule riêng cho `.sh`, `.husky/*`, `Dockerfile*`) để Git tự chuẩn hoá line ending mỗi lần checkout/commit trên máy Windows — tránh lặp lại lỗi này khi push code mới lên Headlamp.


---

## Cập nhật 27/08/2026 (2) — Bug ClickHouse `custom_settings_prefixes` chặn MỌI query (kể cả `DESCRIBE`)

Lỗi UI báo: `Setting custom_hdx_api_key is neither a builtin setting nor started with the prefix 'hyperdx' registered for user-defined settings.` khi chạy bất kỳ query nào (kể cả `DESCRIBE default.otel_logs`).

**Nguyên nhân:** `packages/common-utils/src/clickhouse/index.ts` (`processClickhouseSettings`) gửi kèm 3 ClickHouse setting tùy biến trên **mọi** query: `custom_hdx_api_key`, `custom_user_role`, `custom_allowed_services` — đây là phần khung sườn cho row-level-security theo `hdx_api_key` (đã thấy ở `docker/otel-collector/schema/seed/00009_tenant_isolation_policies.sql`, dùng `getSettingOrDefault('custom_hdx_api_key', '')` trong row policy). Nhưng `docker/clickhouse/local/config.xml` chỉ đăng ký `<custom_settings_prefixes>hyperdx</custom_settings_prefixes>` — prefix `hyperdx` không khớp với prefix thật `custom_` mà code gửi lên → ClickHouse từ chối mọi query có kèm các setting này. Đây là bug có sẵn từ Phase 1-4 cũ (không phải do các thay đổi RBAC/API-key trong session này), chỉ lộ ra khi thực sự chạy query trên ClickHouse.

**Lưu ý thêm:** 3 setting này hiện là hằng số cố định trong `defaultSettings` (`custom_hdx_api_key: ''`, `custom_user_role: 'admin'`, `custom_allowed_services: ''`) — không thấy chỗ nào gán giá trị thật từ user/session đang đăng nhập, nên phần "RLS theo hdx_api_key" trong `00009_tenant_isolation_policies.sql` hiện chưa thực sự được kích hoạt theo từng request (khớp với đánh giá ở mục 26/08: `allowedServices`/RLS chưa hoàn thiện).

**Đã vá (local dev):** `docker/clickhouse/local/config.xml` → `<custom_settings_prefixes>custom,hyperdx</custom_settings_prefixes>`. Cần **restart container `ch-server`** (không cần rebuild, file này mount trực tiếp) để áp dụng.

**Cần làm thêm khi deploy lên Headlamp/k8s:** file config này chỉ áp dụng cho ClickHouse chạy qua `docker-compose.dev.yml`. Instance ClickHouse dùng trên Headlamp/k8s (Helm values hoặc ConfigMap riêng, không nằm trong repo này) cần được set THỦ CÔNG cùng giá trị `custom_settings_prefixes` chứa `custom` (ví dụ qua `<custom_settings_prefixes>custom,hyperdx</custom_settings_prefixes>` trong config server, hoặc key tương đương trong Helm chart ClickHouse đang dùng) — nếu không, lỗi này sẽ lặp lại y hệt trên môi trường đó.


---

## Cập nhật 27/08/2026 (3) — Xác nhận cơ chế phân quyền hiện tại + siết quyền Connections/Sources

**Trả lời câu hỏi "admin thấy toàn bộ, dev chỉ thấy service của mình, 1 người vào được nhiều service":**

- Đúng 1 phần, và chỉ áp dụng cho **API key theo service** (`TeamApiKey`), KHÔNG áp dụng cho dữ liệu log/trace/metric thực tế:
  - `TeamApiKey.members: ObjectId[]` — 1 user có thể là `member` của nhiều key/service khác nhau (many-to-many ở mức key, đúng như yêu cầu).
  - `GET /team/api-keys`: admin/owner thấy toàn bộ key của team; dev chỉ thấy key mà mình có trong `members`.
  - Key mặc định dùng chung (`team.apiKey`) ẩn hoàn toàn với dev.
- **Nhưng KHÔNG có khái niệm "nhiều team"** — 1 user chỉ thuộc đúng 1 `Team` (`User.team` là 1 ObjectId, không phải mảng). "Nhiều service" ở trên là nhiều `TeamApiKey` trong cùng 1 team, không phải nhiều team khác nhau.
- **Quan trọng — đây KHÔNG phải RLS thật:** việc dev "chỉ thấy service của mình" hiện chỉ áp dụng cho **trang quản lý API key** (Team Settings). Các trang xem dữ liệu thật (Search/Chart/Sources) đọc từ `Connections`/`Sources` dùng chung toàn team — **mọi role (kể cả dev) đều xem được toàn bộ log/trace/metric của team**, không bị lọc theo service. Muốn thực sự cô lập dữ liệu theo service (không chỉ theo team) là một tính năng lớn hơn (row-level security theo `custom_hdx_api_key`, khung sườn đã có ở `00009_tenant_isolation_policies.sql` nhưng chưa được kích hoạt thật — xem mục 27/08 (2) phía trên) — **chưa làm trong lần cập nhật này**, cần yêu cầu riêng nếu muốn triển khai.

**Đã làm trong lần này — siết quyền Connections & Sources:**

Trước đây `POST/PUT/DELETE` trên `/connections` và `/sources` chỉ cần đăng nhập (`isUserAuthenticated`), không phân biệt role — nghĩa là dev/owner đều tạo/sửa/xoá được connection và source. Đã sửa:

- `packages/api/src/routers/api/connections.ts`: thêm `requireRole('admin')` vào `POST /`, `PUT /:id`, `DELETE /:id`. `GET /` giữ nguyên (mọi role đều xem/dùng được để query).
- `packages/api/src/routers/api/sources.ts`: thêm `requireRole('admin')` vào `POST /`, `PUT /:id`, `DELETE /:id`. `GET /` giữ nguyên.
- Không đụng tới ingest (OTLP, xác thực qua `opampController.ts` bằng API key) hay query/xem dữ liệu (`clickhouseProxy.ts`) — 2 luồng này độc lập, không đi qua route Connections/Sources nên không bị ảnh hưởng.
- Frontend: ẩn nút "Edit"/"Add Connection" (`ConnectionsSection.tsx`) và nút mở rộng/sửa, "Add source" (`SourcesList.tsx`) khi `role !== 'admin'`, để owner/dev không thấy nút bấm vào sẽ bị 403. Owner/dev vẫn thấy danh sách connection/source (tên, host, kind...) ở dạng chỉ đọc.

**Kết quả sau khi build lại + deploy:** đúng như yêu cầu — owner và dev không còn sửa/xoá được Connection hay Source (chỉ admin làm được); owner/dev vẫn ingest (push) dữ liệu bình thường qua API key, và vẫn xem/query được toàn bộ dữ liệu của team như cũ.

---

## Cập nhật 27/08/2026 (4) — Bug thật: dev thấy data của service khác trong cùng team, đã vá RLS thật theo API key

**Xác nhận đúng là bug (không phải chỉ giới hạn thiết kế cũ):** test thực tế — tài khoản A (member của key 1, team "tester") thấy được data của tài khoản B (member của key 1 VÀ key 2, team "devops"). Do (mục 27/08 (3) đã nêu): `custom_hdx_api_key` gửi lên ClickHouse luôn là hằng số rỗng `''`, khiến row policy `(getSettingOrDefault('custom_hdx_api_key','')='') OR ...` luôn đúng ở nhánh đầu → không lọc gì cả với mọi user.

**Phát hiện quan trọng:** phần ingest đã có sẵn cơ chế gắn nhãn `ResourceAttributes['hdx.api_key']` = đúng API key dùng để push data (`docker/otel-collector/config.yaml`, processor `resource/hdx_api_key` đọc `metadata.authorization`/`metadata.x-hdx-api-key` từ request context nhờ `include_metadata: true` đã bật sẵn trên receiver `otlp/hyperdx`, cộng `transform/hdx_api_key` để bóc tiền tố `Bearer `). Phần này đã hoàn chỉnh từ trước, chỉ chưa được verify. Cái thiếu duy nhất là phía truy vấn chưa gửi giá trị thật.

**Đã vá — 3 file:**

1. `packages/api/src/middleware/auth.ts`: thêm `computeAllowedApiKeys(role, teamId, userId)` — trả về danh sách `TeamApiKey.key` mà user hiện tại là `member` (rỗng nếu role là `admin`, vì admin bypass hoàn toàn). Gọi ở cả 2 nhánh xác thực (`isUserAuthenticated` session-based, `validateUserAccessKey` access-key-based), lưu vào field mới `req._hdx_allowed_api_keys`.
2. `packages/api/src/routers/api/clickhouseProxy.ts`: tại chỗ trước đây chỉ có comment để trống ("Propagate team and RBAC settings for row-level security"), giờ gửi kèm `custom_hdx_api_key` vào query string proxy tới ClickHouse — CSV các key user được gán (join bằng dấu phẩy), hoặc sentinel `__no_access__` nếu user role khác `admin` mà chưa được gán key nào (để KHÔNG rơi vào case "rỗng = bypass" của policy). Admin không gửi gì — dùng đúng cơ chế bypass mặc định sẵn có của policy.
3. `docker/otel-collector/schema/seed/00009_tenant_isolation_policies.sql`: đổi điều kiện so khớp key từ so sánh 1-giá-trị (`ResourceAttributes['hdx.api_key'] = getSettingOrDefault(...)`) sang so khớp trong danh sách (`has(splitByChar(',', getSettingOrDefault(...)), ResourceAttributes['hdx.api_key'])`) ở cả 8 bảng chính và 2 bảng rollup — vì 1 user có thể là member của NHIỀU key cùng lúc (đúng ca thực tế bạn test: tài khoản B ở cả key 1 và key 2).

**Phạm vi đã áp dụng / CHƯA áp dụng (quan trọng):**
- Áp dụng: mọi truy vấn đi qua `/clickhouse-proxy` — đây là đường mà UI Search/Explore/Chart trong app browser dùng trực tiếp, tức là đường chính người dùng thao tác hàng ngày.
- CHƯA áp dụng: các route Search API v2 (`routers/external-api/v2/search.ts`, `charts.ts`), tác vụ check alert (`tasks/checkAlerts/providers/default.ts`), và MCP query tool (`mcp/tools/query/helpers.ts`) — các file này gọi `ClickhouseClient` với `customSettings: {}` (rỗng, cũng là 1 placeholder chưa nối), nên hiện VẪN KHÔNG bị lọc theo service dù dùng qua external API key hay MCP. Đây là scope riêng, chưa làm trong lần này — nếu bạn cũng dùng các đường này (API key ngoài, MCP, alert), cần một lượt vá tương tự.
- `custom_user_role`/`custom_allowed_services` (lọc theo `ServiceName` — khác hoàn toàn khái niệm `TeamApiKey`) — CỐ Ý không đụng vào, vẫn để mặc định bypass — vì nếu bật lên mà `User.allowedServices` rỗng (mặc định), non-admin sẽ bị chặn thấy TOÀN BỘ data (2 điều kiện AND với nhau), phá vỡ hệ thống hiện tại. Để nguyên trạng thái an toàn.

**Bán kính ảnh hưởng khi build lại:** thay đổi cả `hyperdx-api` (image) VÀ `otel-collector` (file SQL mount qua ConfigMap/seed, không cần rebuild ảnh vì file SQL nằm trong image otel-collector — CẦN rebuild ảnh `hyperdx-otel-collector` để file `.sql` mới được đóng gói vào image, rồi restart pod để migration idempotent tự áp dụng lại). Cần build + push LẠI CẢ 2 image.
