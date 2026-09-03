# Deploy fork lên Headlamp — namespace `sandbox` (trống hoàn toàn), chỉ dùng nút Create

Bộ này thay hoàn toàn bộ file cũ trong `k8s/headlamp/`. Lấy cấu trúc tốt hơn
từ ví dụ Helm chart namespace `logging` bạn gửi (tách ClickHouse config qua
ConfigMap, user ClickHouse riêng cho app/otel-collector, DEFAULT_SOURCES đầy
đủ Logs/Traces/Metrics/Sessions, ClickHouse có startupProbe + preStop hook),
nhưng triển khai kiểu manual/Create — **không dùng Helm, không dùng ArgoCD** —
vì bạn xác nhận không có quyền ArgoCD, và namespace `sandbox` hiện đang trống.

## 1. Build + push 2 image (không đổi so với trước)

```bash
docker login -u hieuduongnewai
bash k8s/headlamp/build-and-push.sh
```

## 2. Bấm "Create" trong Headlamp, dán từng file theo ĐÚNG thứ tự này

| # | File | Cần có trước |
|---|---|---|
| 1 | `01-mongodb-pvc.yaml` | — |
| 2 | `02-mongodb-deployment.yaml` | file 1 |
| 3 | `03-mongodb-service.yaml` | file 2 |
| 4 | `04-clickhouse-configmap.yaml` | — |
| 5 | `05-clickhouse-pvc.yaml` | — |
| 6 | `05b-clickhouse-logs-pvc.yaml` | — |
| 7 | `06-clickhouse-deployment.yaml` | file 4, 5, 5b |
| 8 | `07-clickhouse-service.yaml` | file 7 |
| 9 | `08-otel-collector-deployment.yaml` | file 7 (cần ch-server chạy) |
| 10 | `09-otel-collector-service.yaml` | file 9 |
| 11 | `10-hyperdx-api-deployment.yaml` | file 3, 8 (cần db + otel-collector-service) |
| 12 | `11-hyperdx-api-service.yaml` | file 11 |

Mỗi file chỉ chứa **1 resource** — dán nguyên văn, Create, xong mới sang file kế tiếp.

## 3. Sau khi tạo xong hết

Vào tab **Pods** namespace `sandbox`, đợi tất cả các pod `db-*`, `ch-server-*`, `otel-collector-*`, `hyperdx-api-*` chuyển **Running**. `hyperdx-api-*` sẽ ở trạng thái chờ (initContainer `wait-for-mongodb`) cho tới khi pod `db-*` sẵn sàng — bình thường, không phải lỗi.

Nếu PVC (`db-data`, `ch-data`, `ch-logs`) bị `Pending` mãi → cần set `storageClassName` — cho mình biết tên storage class của cluster để mình sửa lại 3 file PVC.

## 4. Truy cập

Theo đúng quy tắc wildcard domain bạn mô tả (mặc định proxy port 80, khác port thì thêm `--<port>`):

- **UI HyperDX**: `https://hyperdx-api.sandbox.kamimind.ai/` (Service `hyperdx-api` port 80 → app port 3000, nên không cần hậu tố).
- **Endpoint OTel để push data** (dùng trong `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_ENDPOINT` của service bạn muốn theo dõi): `https://otel-collector-service--4318.sandbox.kamimind.ai/`
- Ví dụ file `.env` cho 1 service test:
  ```dotenv
  OTEL_ENDPOINT=https://otel-collector-service--4318.sandbox.kamimind.ai
  OTEL_API_KEY=<API key của service đó, tạo trong trang API Keys sau khi đăng nhập>
  OTEL_SERVICE_NAME=<tên service>
  ```

## 5. Đăng ký tài khoản đầu tiên

Mở `https://hyperdx-api.sandbox.kamimind.ai/` → trang đăng ký đầu tiên sẽ tự động là **admin** (đã vá bug này trong fork từ trước). Sau đó vào Team Settings tạo thêm API key riêng cho từng service, mời dev, gán dev vào đúng key — y hệt luồng đã test ở bản trước.

## Những gì khác so với bộ file `sandbox` cũ (đã xoá)

- ClickHouse: 2 PVC riêng (data/logs), có `startupProbe` (chờ ClickHouse boot xong tối đa 300s trước khi tính là fail) và `preStop` hook (flush log/dừng merge trước khi bị kill) — production-grade hơn.
- ClickHouse users: tách `app` (dùng bởi HyperDX app) và `otelcollector` (dùng bởi collector) thay vì dùng chung 1 user `default` — mirror đúng cách namespace `logging` làm, an toàn hơn (dù `default` vẫn giữ lại để bạn troubleshoot khi cần).
- `DEFAULT_SOURCES` của `hyperdx-api` giờ có đủ 4 nguồn: Logs, Traces, Metrics, Sessions (bản cũ chỉ có Logs + Traces) — bạn sẽ thấy đủ các trang trong UI thay vì chỉ Search log/trace.
- Thêm initContainer chờ MongoDB sẵn sàng trước khi app khởi động — tránh app crash-loop vài lần đầu lúc mongo còn đang boot.
- App/API port đổi từ 8080 → 3000 (khớp đúng cổng mà bản Helm chart chính thức dùng), và Service `hyperdx-api` expose thẳng port 80 → 3000 nên URL truy cập không cần hậu tố `--3000`.
- Bỏ hẳn `Secret` (giữ nguyên quyết định từ trước) — `HYPERDX_API_KEY` là plain value.

## Vẫn cần bạn xác nhận / cho biết thêm

1. `storageClassName` của cluster (nếu không có default StorageClass).
2. Domain `https://hyperdx-api.sandbox.kamimind.ai/` có đang bị chiếm bởi DNS/Ingress nào khác từ lần thử trước không (namespace bạn nói đã "trống" nhưng route DNS bên ngoài — nếu có — có thể vẫn còn trỏ tới pod cũ đã xoá; nếu vào bị lỗi 502/504 lâu sau khi pod đã Running, khả năng do đó, báo mình biết để kiểm tra tiếp).
