'use strict';
const logger = require('./utils/logger');
/* ═══════════════════════════════════════════════════════════
   SmartBusAI — Swagger / OpenAPI 3.0 Documentation
   Accessible at: GET /api-docs
═══════════════════════════════════════════════════════════ */

const swaggerUi   = require('swagger-ui-express');

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title:       'SmartBusAI API',
    version:     '2.0.0',
    description: 'Nền tảng đặt vé xe buýt thông minh — REST API Documentation',
    contact: { name: 'SmartBusAI Team', email: 'support@smartbusai.vn' },
    license:  { name: 'MIT' }
  },
  servers: [
    { url: 'http://localhost:2704', description: 'Development server' }
  ],
  tags: [
    { name: 'Auth',      description: 'Xác thực và phân quyền' },
    { name: 'Trips',     description: 'Quản lý chuyến xe' },
    { name: 'Bookings',  description: 'Đặt vé và thanh toán' },
    { name: 'Users',     description: 'Quản lý người dùng' },
    { name: 'Loyalty',   description: 'Điểm thưởng khách hàng' },
    { name: 'Reviews',   description: 'Đánh giá chuyến xe' },
    { name: 'Admin',     description: 'Quản trị hệ thống' },
    { name: 'AI',        description: 'AI Engine & Analytics' },
    { name: 'Operators', description: 'Quản lý nhà xe' },
    { name: 'Support',   description: 'Hỗ trợ khách hàng' },
    { name: 'Seats',     description: 'Quản lý ghế xe' },
    { name: 'Buses',     description: 'Quản lý xe buýt' },
    { name: 'Ops',       description: 'Vận hành & giám sát hệ thống (health-check, uptime, DB pool)' }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
        description:  'JWT access token (15 phút). Dùng /api/auth/login để lấy token.'
      }
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          user_id:    { type: 'integer', example: 1 },
          username:   { type: 'string',  example: 'nguyen_van_a' },
          full_name:  { type: 'string',  example: 'Nguyễn Văn A' },
          email:      { type: 'string',  example: 'a@email.com' },
          phone:      { type: 'string',  example: '0901234567' },
          role:       { type: 'string',  enum: ['ADMIN','OPERATOR','PASSENGER'], example: 'PASSENGER' },
          status:     { type: 'string',  enum: ['ACTIVE','INACTIVE','BANNED'], example: 'ACTIVE' },
          loyalty_points: { type: 'integer', example: 1200 },
          loyalty_tier:   { type: 'string',  enum: ['BRONZE','SILVER','GOLD','DIAMOND'], example: 'SILVER' }
        }
      },
      Booking: {
        type: 'object',
        properties: {
          booking_id:    { type: 'integer', example: 42 },
          user_id:       { type: 'integer', example: 1 },
          trip_id:       { type: 'integer', example: 7 },
          total_amount:  { type: 'number',  example: 250000 },
          status:        { type: 'string',  enum: ['PENDING','PAID','CONFIRMED','CANCELED'], example: 'PAID' },
          booking_time:  { type: 'string',  format: 'date-time' },
          extras:        { type: 'string',  description: 'JSON array of amenities' }
        }
      },
      Trip: {
        type: 'object',
        properties: {
          trip_id:        { type: 'integer', example: 7 },
          route_id:       { type: 'integer', example: 3 },
          bus_id:         { type: 'integer', example: 2 },
          base_price:     { type: 'number',  example: 120000 },
          departure_time: { type: 'string',  format: 'date-time' },
          arrival_time:   { type: 'string',  format: 'date-time' },
          status:         { type: 'string',  enum: ['SCHEDULED','RUNNING','COMPLETED','CANCELED'] },
          origin:         { type: 'string',  example: 'Hà Nội' },
          destination:    { type: 'string',  example: 'TP. Hồ Chí Minh' }
        }
      },
      LoyaltyInfo: {
        type: 'object',
        properties: {
          points:       { type: 'integer', example: 1250 },
          tier:         { type: 'string',  example: 'SILVER' },
          tierLabel:    { type: 'string',  example: '🥈 Bạc' },
          tierColor:    { type: 'string',  example: '#c0c0c0' },
          tierDiscount: { type: 'integer', example: 5, description: 'Discount % for tier' },
          nextTier:     { type: 'string',  example: 'GOLD' },
          nextTierAt:   { type: 'integer', example: 2000 },
          progress:     { type: 'integer', example: 62, description: 'Progress % to next tier' },
          redeemRate:   { type: 'integer', example: 100, description: '100 pts = 10,000 VND' },
          earnRate:     { type: 'integer', example: 1,   description: '1 pt per 1,000 VND' },
          transactions: { type: 'array',   items: { type: 'object' } }
        }
      },
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Lỗi không xác định' }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['email','password'],
        properties: {
          email:    { type: 'string', example: 'admin@smartbusai.vn' },
          password: { type: 'string', example: 'Admin@123' }
        }
      },
      LoginResponse: {
        type: 'object',
        properties: {
          message:      { type: 'string', example: 'Đăng nhập thành công' },
          accessToken:  { type: 'string', description: 'JWT — expires 15m' },
          refreshToken: { type: 'string', description: 'JWT — expires 7d' },
          user:         { $ref: '#/components/schemas/User' }
        }
      },
      DynamicPrice: {
        type: 'object',
        properties: {
          trip_id:       { type: 'integer' },
          base_price:    { type: 'number' },
          dynamic_price: { type: 'number' },
          multiplier:    { type: 'number', example: 1.12 },
          reason:        { type: 'string', example: 'Còn 2 ngày khởi hành · Ghế 78% đầy' },
          occupancy_pct: { type: 'number', example: 78 },
          days_until_departure: { type: 'number', example: 2 }
        }
      }
    }
  },
  paths: {
    /* ── AUTH ── */
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Đăng nhập',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: {
          200: { description: 'Thành công', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          401: { description: 'Sai mật khẩu', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Quá nhiều yêu cầu (10/15 phút)' }
        }
      }
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Đăng ký tài khoản mới',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['username','email','password','full_name'],
                properties: {
                  username:  { type: 'string' },
                  email:     { type: 'string', format: 'email' },
                  password:  { type: 'string', minLength: 6 },
                  full_name: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Đăng ký thành công' },
          400: { description: 'Email hoặc username đã tồn tại' }
        }
      }
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'], summary: 'Làm mới access token',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } }
        },
        responses: {
          200: { description: 'Token mới', content: { 'application/json': { schema: { type: 'object', properties: { accessToken: { type: 'string' } } } } } },
          401: { description: 'Refresh token không hợp lệ' }
        }
      }
    },
    /* ── TRIPS ── */
    '/api/trips': {
      get: {
        tags: ['Trips'], summary: 'Lấy danh sách tất cả chuyến xe',
        parameters: [
          { in: 'query', name: 'origin',      schema: { type: 'string' }, description: 'Điểm xuất phát' },
          { in: 'query', name: 'destination', schema: { type: 'string' }, description: 'Điểm đến' },
          { in: 'query', name: 'date',        schema: { type: 'string', format: 'date' }, description: 'Ngày khởi hành (YYYY-MM-DD)' }
        ],
        responses: {
          200: { description: 'Danh sách chuyến', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Trip' } } } } }
        }
      }
    },
    '/api/trips/{id}/dynamic-price': {
      get: {
        tags: ['Trips','AI'], summary: 'Lấy giá động (AI pricing engine)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Giá động', content: { 'application/json': { schema: { $ref: '#/components/schemas/DynamicPrice' } } } }
        }
      }
    },
    /* ── BOOKINGS ── */
    '/api/bookings': {
      post: {
        tags: ['Bookings'], summary: 'Tạo đặt vé mới',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['user_id','trip_id','seats'],
                properties: {
                  user_id:        { type: 'integer' },
                  trip_id:        { type: 'integer' },
                  seats:          { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, type: { type: 'string', enum: ['NORMAL','VIP'] } } } },
                  status:         { type: 'string', enum: ['PENDING','PAID'], default: 'PAID' },
                  payment_method: { type: 'string', enum: ['MOMO','ZALOPAY','BANK','CASH'] },
                  extras:         { type: 'array',  items: { type: 'object', properties: { id: { type: 'string' }, qty: { type: 'integer' } } } }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Đặt vé thành công', content: { 'application/json': { schema: { type: 'object', properties: { booking_id: { type: 'integer' }, total: { type: 'number' } } } } } },
          400: { description: 'Ghế đã được đặt hoặc thiếu dữ liệu' }
        }
      }
    },
    '/api/bookings/ticker': {
      get: {
        tags: ['Bookings'], summary: 'Ticker công khai trên trang chủ (Sprint 3 — tách khỏi GET /api/bookings đầy đủ)',
        description: 'Public, không cần đăng nhập. Giới hạn cứng 20 dòng gần nhất, chỉ trả về các trường hiển thị trên UI — không có email/số điện thoại/booking_id/user_id/phương thức thanh toán. `full_name` được ẩn danh phía server (ví dụ "Nguyễn Văn An" → "An N.") trước khi rời server, không phải ẩn danh phía client.',
        responses: {
          200: {
            description: 'Tối đa 20 booking gần nhất (đã ẩn danh)',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      full_name:    { type: 'string', example: 'An N.' },
                      booking_time: { type: 'string', format: 'date-time' },
                      total_amount: { type: 'number' },
                      status:       { type: 'string', enum: ['PENDING','PAID','CANCELED'] },
                      origin:       { type: 'string' },
                      destination:  { type: 'string' },
                      bus_type:     { type: 'string' },
                      seat_numbers: { type: 'string', example: 'A1, A2' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/bookings/{id}/pay': {
      post: {
        tags: ['Bookings'], summary: 'Thanh toán vé (PENDING → PAID)',
        security: [{ BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { method: { type: 'string', enum: ['CASH','MOMO','ZALOPAY','BANK'] } } } } }
        },
        responses: {
          200: { description: 'Thanh toán thành công — tự động cộng điểm loyalty và gửi email xác nhận' },
          400: { description: 'Vé đã được thanh toán hoặc đã huỷ' },
          404: { description: 'Không tìm thấy vé' }
        }
      }
    },
    '/api/bookings/{id}/qr': {
      get: {
        tags: ['Bookings'], summary: 'Lấy QR code e-ticket',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'QR ticket data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    qr_image:  { type: 'string', description: 'Base64 PNG data URL' },
                    checksum:  { type: 'string', description: 'HMAC-SHA256 12-char checksum' },
                    full_name: { type: 'string' },
                    origin:    { type: 'string' },
                    destination: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/bookings/verify-qr': {
      post: {
        tags: ['Bookings'], summary: 'Xác thực QR (dành cho operator quét vé)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { qr_data: { type: 'string' } } } } }
        },
        responses: {
          200: { description: 'Kết quả xác thực', content: { 'application/json': { schema: { type: 'object', properties: { valid: { type: 'boolean' }, status: { type: 'string' }, full_name: { type: 'string' } } } } } }
        }
      }
    },
    /* ── USERS / LOYALTY ── */
    '/api/users': {
      get: {
        tags: ['Users'], summary: 'Lấy danh sách tất cả người dùng',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Danh sách users', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } }
        }
      }
    },
    '/api/users/{id}/loyalty': {
      get: {
        tags: ['Users','Loyalty'], summary: 'Lấy thông tin điểm thưởng của user',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Thông tin loyalty', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoyaltyInfo' } } } }
        }
      }
    },
    '/api/users/{id}/redeem-points': {
      post: {
        tags: ['Users','Loyalty'], summary: 'Đổi điểm thưởng lấy giảm giá',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['points'],
                properties: { points: { type: 'integer', example: 100, description: '100 điểm = 10,000 VND' } }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Đổi điểm thành công',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    discountAmount: { type: 'number', example: 10000 },
                    newPoints:      { type: 'integer', example: 1150 },
                    newTier:        { type: 'string',  example: 'SILVER' }
                  }
                }
              }
            }
          },
          400: { description: 'Không đủ điểm' }
        }
      }
    },
    /* ── AI ── */
    '/api/ai/concierge': {
      post: {
        tags: ['AI'], summary: 'AI Booking Concierge — đặt vé bằng ngôn ngữ tự nhiên tiếng Việt (Sprint 4)',
        description: 'Public, không cần đăng nhập. Rule-based Vietnamese NLU (regex/keyword matching, không phải mô hình huấn luyện) trích xuất điểm đi/điểm đến/ngày/loại xe/khung giờ/số vé từ một câu tự do, sau đó gọi thẳng cùng một SQL search engine với `GET /api/trips/search` (không có dữ liệu mock độc lập nào). Nếu thiếu điểm đi hoặc điểm đến, trả về câu hỏi làm rõ thay vì tìm kiếm.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['message'],
                properties: {
                  message: { type: 'string', maxLength: 500, example: 'Tôi muốn đi từ Hà Nội đến Đà Nẵng tối mai tầm 8h, vé Limousine' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Phản hồi AI — kèm intent trích xuất và danh sách chuyến thật (nếu có đủ thông tin)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reply: { type: 'string' },
                    intent: {
                      type: 'object', nullable: true,
                      properties: {
                        origin:       { type: 'string', nullable: true },
                        destination:  { type: 'string', nullable: true },
                        travel_date:  { type: 'string', format: 'date', nullable: true },
                        bus_type:     { type: 'string', enum: ['LIMOUSINE','VIP','NORMAL'], nullable: true },
                        time_window:  { type: 'object', nullable: true },
                        seat_count:   { type: 'integer', nullable: true }
                      }
                    },
                    trips:     { type: 'array', items: { $ref: '#/components/schemas/Trip' } },
                    needsInfo: { type: 'array', items: { type: 'string', enum: ['origin','destination'] } }
                  }
                }
              }
            }
          },
          400: { description: 'Thiếu nội dung tin nhắn' },
          422: { description: 'Tin nhắn quá dài (tối đa 500 ký tự)' }
        }
      }
    },
    '/api/admin/ai/recommendations': {
      get: {
        tags: ['AI'], summary: 'Gợi ý tuyến đường cá nhân hoá (Collaborative Filtering)',
        parameters: [{ in: 'query', name: 'user_id', schema: { type: 'integer' }, description: 'ID người dùng (optional)' }],
        responses: { 200: { description: 'Danh sách tuyến gợi ý' } }
      }
    },
    '/api/admin/ai/revenue-forecast': {
      get: {
        tags: ['AI'], summary: 'Dự báo doanh thu 30 ngày tới (Linear Regression)',
        responses: { 200: { description: 'Dự báo với confidence interval' } }
      }
    },
    '/api/admin/ai/anomalies': {
      get: {
        tags: ['AI'], summary: 'Phát hiện bất thường (7-day rolling average)',
        responses: { 200: { description: 'Danh sách anomalies (booking drops, cancellation spikes)' } }
      }
    },
    '/api/admin/ai/heatmap': {
      get: {
        tags: ['AI'], summary: 'Booking heatmap theo giờ và ngày (7×24)',
        responses: { 200: { description: 'Matrix 7 ngày × 24 giờ' } }
      }
    },
    '/api/admin/ai/price-prediction': {
      get: {
        tags: ['AI'], summary: 'Dự đoán giá tối ưu cho tuyến đường',
        parameters: [
          { in: 'query', name: 'route_id', schema: { type: 'integer' } },
          { in: 'query', name: 'date',     schema: { type: 'string', format: 'date' } }
        ],
        responses: { 200: { description: 'Giá dự đoán theo ngày/tuyến' } }
      }
    },
    '/api/admin/ai/classify-ticket': {
      post: {
        tags: ['AI','Support'], summary: 'Phân loại ticket hỗ trợ bằng rule-based keyword classifier (tiếng Việt)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title:   { type: 'string', example: 'Vé bị trùng ghế' },
                  content: { type: 'string', example: 'Tôi đặt ghế số 12 nhưng có người khác cũng ngồi chỗ đó' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Phân loại + câu trả lời gợi ý',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    category:          { type: 'string', example: 'booking_issue' },
                    confidence:        { type: 'number', example: 0.85 },
                    suggestedResponse: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    /* ── ADMIN ── */
    '/api/admin/stats': {
      get: {
        tags: ['Admin'], summary: 'Thống kê tổng quan hệ thống',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'KPI dashboard',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalUsers:    { type: 'integer' },
                    totalBookings: { type: 'integer' },
                    totalRevenue:  { type: 'number' },
                    totalTrips:    { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/admin/notifications': {
      get: {
        tags: ['Admin'], summary: 'Lấy thông báo admin (tất cả loại)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Danh sách thông báo',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type:    { type: 'string', enum: ['new_user','new_operator','new_booking','cancel_booking','support','new_review','service_order'] },
                      title:   { type: 'string' },
                      message: { type: 'string' },
                      time:    { type: 'string', format: 'date-time' },
                      link:    { type: 'string' },
                      icon:    { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    /* ── OPS ── */
    '/api/health': {
      get: {
        tags: ['Ops'], summary: 'Health-check sản xuất (Sprint 5) — trạng thái DB pool, RAM, uptime',
        description: 'Public (không cần đăng nhập — endpoint giám sát/ops, không có PII). Mọi số liệu là giá trị đo thực tại thời điểm gọi (real-time ping tới DB, process.memoryUsage(), process.uptime()) — không có số liệu tĩnh/giả lập.',
        responses: {
          200: {
            description: 'Hệ thống khoẻ mạnh hoặc chậm (degraded — DB ping > 200ms)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:          { type: 'string', enum: ['healthy','degraded','down'] },
                    timestamp:       { type: 'string', format: 'date-time' },
                    uptime_seconds:  { type: 'integer' },
                    database: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                        ping_ms:   { type: 'integer', nullable: true },
                        pool: {
                          type: 'object', nullable: true,
                          properties: {
                            total:  { type: 'integer' },
                            idle:   { type: 'integer' },
                            active: { type: 'integer' },
                            limit:  { type: 'integer', nullable: true }
                          }
                        }
                      }
                    },
                    memory_mb: {
                      type: 'object',
                      properties: {
                        rss: { type: 'number' }, heap_used: { type: 'number' },
                        heap_total: { type: 'number' }, external: { type: 'number' }
                      }
                    },
                    node_version: { type: 'string' }
                  }
                }
              }
            }
          },
          503: { description: 'DB không kết nối được (status: "down")' }
        }
      }
    },

    /* ── STATS (public) ── */
    '/api/stats/public-summary': {
      get: {
        tags: ['Ops'], summary: 'Số liệu công khai trang đăng nhập (Cache-Aside, 30s TTL)',
        responses: {
          200: { description: 'Tổng quan hệ thống', content: { 'application/json': { schema: { type: 'object', properties: {
            totalRoutes: { type: 'integer' }, totalPassengers: { type: 'integer' },
            avgRating: { type: 'string' }, completionRate: { type: 'number', nullable: true },
          } } } } },
          500: { description: 'Lỗi CSDL', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },

    /* ── STOPS ── */
    '/api/stops/nearest': {
      get: {
        tags: ['Trips'], summary: 'Điểm đón/trả gần nhất theo GPS (Haversine)',
        parameters: [
          { in: 'query', name: 'lat', required: true, schema: { type: 'number' } },
          { in: 'query', name: 'lng', required: true, schema: { type: 'number' } },
          { in: 'query', name: 'route_id', schema: { type: 'integer' } },
          { in: 'query', name: 'type', schema: { type: 'string', enum: ['PICKUP', 'DROPOFF'] } },
        ],
        responses: { 200: { description: 'Danh sách điểm dừng sắp xếp theo khoảng cách tăng dần (WAYPOINT bị loại trừ)' } }
      }
    },

    /* ── SEATS ── */
    '/api/seats/trip/{tripId}': {
      get: {
        tags: ['Seats'], summary: 'Sơ đồ ghế của một chuyến xe',
        parameters: [{ in: 'path', name: 'tripId', required: true, schema: { type: 'integer' } }],
        responses: {
          200: { description: 'Danh sách ghế', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: {
            seat_id: { type: 'integer' }, seat_number: { type: 'string' }, seat_type: { type: 'string', enum: ['NORMAL', 'VIP'] },
            isBooked: { type: 'integer', enum: [0, 1] },
          } } } } } }
        }
      }
    },

    /* ── REVIEWS ── */
    '/api/reviews': {
      post: {
        tags: ['Reviews'], summary: 'Gửi đánh giá chuyến đi', security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['trip_id', 'rating'], properties: {
          trip_id: { type: 'integer' }, rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string' },
          rating_time: { type: 'integer' }, rating_clean: { type: 'integer' }, rating_service: { type: 'integer' }, rating_comfort: { type: 'integer' },
        } } } } },
        responses: { 201: { description: 'Đã lưu đánh giá' }, 400: { description: 'Rating không hợp lệ' } }
      }
    },

    /* ── SUPPORT ── */
    '/api/support': {
      post: {
        tags: ['Support'], summary: 'Gửi yêu cầu hỗ trợ', security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          type: { type: 'string', enum: ['GENERAL', 'BOOKING', 'PAYMENT', 'REFUND', 'TECHNICAL', 'COMPLAINT', 'OTHER'] },
          title: { type: 'string' }, content: { type: 'string' }, booking_id: { type: 'integer', nullable: true },
        } } } } },
        responses: { 201: { description: 'Đã tạo yêu cầu hỗ trợ' } }
      }
    },

    /* ── OPERATORS ── */
    '/api/operators': {
      get: { tags: ['Operators'], summary: 'Danh sách nhà xe', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Danh sách nhà xe' } } },
      post: { tags: ['Operators'], summary: 'Tạo nhà xe mới (Admin)', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Đã tạo' } } }
    },
    '/api/operators/dashboard/stats': {
      get: { tags: ['Operators'], summary: 'Thống kê tổng quan cho nhà xe (doanh thu, chuyến, đặt vé)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'KPI dashboard nhà xe' } } }
    },

    /* ── BUSES ── */
    '/api/buses': {
      get: { tags: ['Buses'], summary: 'Danh sách xe buýt', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Danh sách xe' } } },
      post: { tags: ['Buses'], summary: 'Thêm xe mới', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Đã tạo xe' } } }
    },

    /* ── SEARCH (transit + analytics) ── */
    '/api/search/transit': {
      post: {
        tags: ['Trips'], summary: 'Tìm hành trình trung chuyển (BFS có trọng số, tối đa 3 chặng)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['origin', 'destination'], properties: {
          origin: { type: 'string' }, destination: { type: 'string' }, date: { type: 'string', format: 'date' },
          mode: { type: 'string', enum: ['time', 'cost', 'hops'], default: 'time' },
        } } } } },
        responses: {
          200: { description: 'Danh sách phương án (direct + transit)' },
          503: { description: 'Mất kết nối CSDL — trả về degraded:true thay vì lỗi 500 (Graceful Degradation, Pillar 2)' }
        }
      }
    },
    '/api/search/analytics': {
      get: { tags: ['Admin'], summary: 'Top tuyến tìm kiếm nhiều nhất + lượt tìm theo thời gian (EPIC 8)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Thống kê tìm kiếm' } } }
    },

    /* ── LOCATIONS ── */
    '/api/locations': {
      get: { tags: ['Admin'], summary: 'Danh sách địa điểm/bến xe kèm GPS', responses: { 200: { description: 'Danh sách địa điểm' } } }
    },

    /* ── AI (Sprint 11/12 additions) ── */
    '/api/ai/predict-intent': {
      post: {
        tags: ['AI'], summary: 'Dự đoán điểm ý định đặt vé trong phiên (rule-based scoring, không phải mô hình huấn luyện)',
        description: 'Public/optionalAuth — hoạt động cho cả khách vãng lai. Rate-limited 30 req/phút/IP.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['session_events'], properties: {
          session_events: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['SEARCH', 'VIEW_TRIP', 'SELECT_SEAT', 'START_PAYMENT', 'COMPLETE_BOOKING', 'CANCEL'] }, timestamp: { type: 'string', format: 'date-time' } } } },
        } } } } },
        responses: { 200: { description: 'Kết quả dự đoán', content: { 'application/json': { schema: { type: 'object', properties: {
          intent_score: { type: 'number', example: 77 }, intent_level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          dropoff_risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, recommended_action: { type: 'string', example: 'HOLD_SEAT' },
        } } } } } }
      }
    },
    '/api/ai/demand-forecast': {
      get: { tags: ['AI', 'Admin'], summary: 'Dự báo nhu cầu theo tuyến (heuristic thống kê, 7 ngày tới)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Danh sách dự báo theo tuyến' } } }
    },
    '/api/ai/behavioral-analytics': {
      get: { tags: ['AI', 'Admin'], summary: 'Phân bố hành vi hệ thống (giá/khung giờ/loại xe) + log AI Intent Predictor', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Thống kê hành vi toàn hệ thống' } } }
    },
    '/api/recommendations/trending': {
      get: { tags: ['AI'], summary: 'Top tuyến phổ biến (public, Cache-Aside 30s TTL)', responses: { 200: { description: 'Danh sách tuyến phổ biến' } } }
    },

    /* ── ADMIN: routes/locations CRUD + demo mode ── */
    '/api/admin/all-routes': {
      get: { tags: ['Admin'], summary: 'Danh sách tất cả tuyến đường (quản trị)', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Danh sách tuyến' } } }
    },
    '/api/admin/routes': {
      post: { tags: ['Admin'], summary: 'Tạo tuyến đường mới', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Đã tạo tuyến' } } }
    },
    '/api/admin/routes/import/preview': {
      post: {
        tags: ['Admin'], summary: 'Xem trước import hàng loạt tuyến đường từ CSV/Excel (đã parse thành JSON ở Frontend)',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          rows: { type: 'array', maxItems: 500, items: { type: 'object', properties: { origin: { type: 'string' }, destination: { type: 'string' }, distance_km: { type: 'number' } } } },
        } } } } },
        responses: { 200: { description: 'Kết quả kiểm tra từng dòng (lỗi, trùng lặp)' }, 400: { description: 'Không có dữ liệu hoặc vượt quá 500 dòng' } }
      }
    },
    '/api/admin/routes/import/confirm': {
      post: { tags: ['Admin'], summary: 'Xác nhận import các dòng hợp lệ vào CSDL', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Số dòng đã import thành công' } } }
    },
    '/api/admin/demo/reset': {
      post: {
        tags: ['Admin'], summary: 'Khôi phục Demo 1-Click — huỷ vé PENDING tồn đọng + xoá log AI thử nghiệm (không đụng dữ liệu thật)',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Kết quả khôi phục', content: { 'application/json': { schema: { type: 'object', properties: {
          message: { type: 'string' }, canceled_pending_bookings: { type: 'integer' }, cleared_intent_logs: { type: 'integer' },
        } } } } } }
      }
    }
  }
};

/* ── Custom dark theme CSS for Swagger UI ── */
const customCss = `
  body { background: #020c1b !important; }
  .swagger-ui { background: #020c1b; }
  .swagger-ui .topbar { background: linear-gradient(90deg,#020c1b,#030d1f); border-bottom: 1px solid rgba(0,255,224,.2); }
  .swagger-ui .topbar .download-url-wrapper { display:none; }
  .swagger-ui .info .title { color: #00ffe0; font-size:2rem; }
  .swagger-ui .info p, .swagger-ui .info li { color: rgba(255,255,255,.75); }
  .swagger-ui .scheme-container { background: #041122; border:1px solid rgba(0,255,224,.15); }
  .swagger-ui .opblock-tag { color: #00ffe0; border-bottom:1px solid rgba(0,255,224,.15); }
  .swagger-ui .opblock { border-radius:8px; margin:4px 0; }
  .swagger-ui .opblock .opblock-summary-description { color: rgba(255,255,255,.6); }
  .swagger-ui .opblock.opblock-get    { background:rgba(0,200,255,.06);  border-color:rgba(0,200,255,.3); }
  .swagger-ui .opblock.opblock-post   { background:rgba(0,255,160,.06);  border-color:rgba(0,255,160,.3); }
  .swagger-ui .opblock.opblock-put    { background:rgba(255,170,0,.06);  border-color:rgba(255,170,0,.3); }
  .swagger-ui .opblock.opblock-delete { background:rgba(255,60,60,.06);  border-color:rgba(255,60,60,.3); }
  .swagger-ui .opblock-body pre, .swagger-ui textarea { background:#041122 !important; color:#00ffe0 !important; }
  .swagger-ui .btn.execute { background: #00ffe0; color: #020c1b; font-weight:700; border:none; }
  .swagger-ui .btn.execute:hover { background:#00bfaa; }
  .swagger-ui select, .swagger-ui input[type=text] { background:#041122; color:#e0f7fa; border:1px solid rgba(0,255,224,.3); }
  .swagger-ui .model-box { background:#041122; }
  .swagger-ui section.models { border:1px solid rgba(0,255,224,.15); background:#020c1b; }
  .swagger-ui .model { color: rgba(255,255,255,.8); }
  .swagger-ui .parameter__name { color: #00ffe0; }
  .swagger-ui .response-col_status { color: #00ffe0; }
  .swagger-ui table tbody tr td { border-bottom:1px solid rgba(255,255,255,.05); color:rgba(255,255,255,.8); }
`;

const customSiteTitle = 'SmartBusAI — API Docs';

module.exports = function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss,
    customSiteTitle,
    customfavIcon: '/icons/icon.svg',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      deepLinking: true,
      tryItOutEnabled: true
    }
  }));
  logger.info('📚 [Swagger] API docs available at /api-docs');
};
