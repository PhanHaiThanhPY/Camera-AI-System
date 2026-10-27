import { ReactElement } from "react";

const MATERIALS = [
  { code: "sand", label: "Cát", caption: "Hạt mịn · màu và bề mặt" },
  { code: "stone-2-3", label: "Đá 2–3", caption: "Đối chiếu mẫu chuẩn tại cơ sở" },
  { code: "stone-4-6", label: "Đá 4–6", caption: "Đối chiếu cấp hạt" },
  { code: "boulder", label: "Đá tảng", caption: "Khối lớn nhìn thấy" }
] as const;

const PARTICLES = [
  [[17, 62, 1.7], [27, 55, 1.3], [38, 49, 1.8], [50, 41, 1.5], [63, 35, 1.4], [76, 28, 1.7], [88, 21, 1.3], [28, 76, 1.2], [68, 69, 1.5]],
  [[15, 68, 5], [26, 57, 5.5], [37, 51, 4.5], [46, 43, 5.5], [58, 38, 5], [69, 31, 5], [80, 25, 4.5], [88, 21, 3.5], [75, 74, 3.5]],
  [[17, 71, 9], [31, 57, 8], [44, 50, 9], [56, 39, 8], [68, 31, 9], [81, 23, 7], [89, 20, 6], [77, 75, 6]],
  [[17, 70, 13], [36, 57, 12], [56, 46, 13], [75, 34, 12], [87, 19, 10]]
] as const;

function MaterialIllustration({ index }: { index: number }): ReactElement {
  const particles = PARTICLES[index] ?? PARTICLES[0];
  return (
    <svg aria-hidden="true" className={`material-illustration material-illustration-${index}`} viewBox="0 0 100 100">
      {particles.map(([cx, cy, radius], particleIndex) => <circle cx={cx} cy={cy} fill={index === 0 ? "#c8a96b" : particleIndex % 2 === 0 ? "#849bae" : "#a8bac8"} key={`${cx}-${cy}`} r={radius} />)}
    </svg>
  );
}

function MaterialReferencePanel(): ReactElement {
  return (
    <div className="material-overview">
      <section className="panel material-reference">
        <h2>Bốn nhóm hàng · mẫu thật quyết định nhãn</h2>
        <div className="material-cards">
          {MATERIALS.map((material, index) => (
            <article className="material-card" key={material.code}>
              <div className="material-sample"><MaterialIllustration index={index} /></div>
              <h3>{material.label}</h3>
              <p>{material.caption}</p>
            </article>
          ))}
        </div>
        <p className="material-footnote">Minh hoạ đặc trưng thị giác; tên cấp đá theo danh mục được khách hàng xác nhận.</p>
      </section>
      <aside className="panel material-rules">
        <ul>
          <li>Cát, đá 2–3, đá 4–6 và đá tảng là bốn nhãn ban đầu; tên thương mại gắn với mẫu chuẩn của từng cơ sở.</li>
          <li>AI phân tích ảnh vùng hàng và so sánh với các mẫu đã được xác nhận để đề xuất loại vật liệu.</li>
          <li>Ảnh chỉ mô tả lớp vật liệu nhìn thấy. Chất lượng cấp phối, độ ẩm và phần khuất cần quy trình lấy mẫu xác nhận.</li>
          <li>Hàng trộn, phủ bạt, bùn che hoặc thiếu sáng cần chuyển người kiểm tra; không tự gán sang loại gần nhất.</li>
        </ul>
        <p className="material-training-note"><strong>Dữ liệu huấn luyện</strong><br />Ảnh hiện lưu là crop quanh toàn bộ xe, chưa riêng vùng hàng. Muốn dùng cho huấn luyện cần ghép thêm nhãn đã xác nhận với đúng crop vùng hàng.</p>
      </aside>
    </div>
  );
}

/** Xác nhận vật liệu: nhãn chuẩn và nguyên tắc đối chiếu — chỉ còn là trang tham khảo. Việc xem/sửa/xác
 *  nhận từng lượt xe đã chuyển hẳn sang Sổ cân & truy vết (CapturesTable.tsx → PassPage.tsx). */
export default function ConfirmPage(): ReactElement {
  return (
    <section className="main-column material-page">
      <MaterialReferencePanel />
    </section>
  );
}
