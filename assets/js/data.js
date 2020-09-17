const app = Vue.createApp({
    data(){
        return {
            des:'我畢業於中原大學資訊工程學系，第一份工作在偶然的機會下踏入UI以及網頁設計的領域，資歷大約3年左右。'+
                '舉凡平面設計、系統平台、一頁式活動網站、行動裝置介面設計、點歌機系統介面等不同類型的UI，都有涉獵。'+
                '也因為喜歡畫畫，所以也出品過很多款不同風格的Line插畫貼圖。不管是遊戲風格的插畫或者是漫畫風格我都能'+
                '自由發揮，將自己創作融入生活，也是我想做的事。在這段職涯中因緣際會加入新創公司，接觸了專案管理，以'+
                '及累積完整的專案開發經歷，這對我來說非常有意義，也期許未來自己的專業能對於團隊有所貢獻。',
                
            timeLine:'第一份工作是在台達電子擔任UI設計師，80%的時間設計軟體介面，20%時間協助部門測試智慧電錶'+
                     '後期部門營收不佳，被迫轉型成為硬體領域，但由於部門前景以及狀況未明確很長一段時間，所以萌生'+
                     '嘗試不同的領域的想法，而當時看到一間新創公司想要做跟服務相關的題目，我聽完介紹後，認為有發'+
                     '展的可能，所以轉換了跑道。在公司成長的期間，我也被委任PM的職務。新創公司生存不容易，後期因'+
                     '投入市場後，狀況不如預期，股東考量後決定不再繼續投資，只好選擇離開。後來轉換跑道',
            index:[
                {link:'work_system.html',img:'images/pic01.jpg',title:'Web/系統 UI'},
                {link:'work_app.html',img:'images/pic02.jpg',title:'APP UI'},
                {link:'work_LOGO.html',img:'images/logo/img_02.jpg',title:'LOGO設計'},
                {link:'work_active.html',img:'images/pic04.jpg',title:'平面相關設計'},
                {link:'work_painter.html',img:'images/pic03.jpg',title:'插畫/繪圖'},
                {link:'work_gambleWeb.html',img:'images/pic04a.png',title:'博弈UI/美術'}
            ],
            banner:[
                {img:'images/gambleBanner/img_g01.jpg'},
                {img:'images/gambleBanner/img_g02.jpg'},
                {img:'images/gambleBanner/img_g03.jpg'},
                {img:'images/gambleBanner/img_g04.jpg'},
                {img:'images/gambleBanner/img_g05.jpg'},
                {img:'images/gambleBanner/img_g06.jpg'},
                {img:'images/gambleBanner/img_g07.jpg'},
                {img:'images/gambleBanner/img_g08.jpg'},
                {img:'images/gambleBanner/img_g09.jpg'},
                {img:'images/gambleBanner/img_g10.jpg'},
                {img:'images/gambleBanner/img_g11.jpg'},
                {img:'images/gambleBanner/img_g12.jpg'},
                {img:'images/gambleBanner/img_g13.jpg'},
                {img:'images/gambleBanner/img_g14.jpg'},
                {img:'images/gambleBanner/img_g15.jpg'},
                {img:'images/gambleBanner/img_g16.jpg'},
                {img:'images/gambleBanner/img_g17.jpg'},
                {img:'images/gambleBanner/img_g18.jpg'},
                {img:'images/gambleBanner/img_g19.jpg'},
                {img:'images/gambleBanner/img_g20.jpg'},
                {img:'images/gambleBanner/img_g21.jpg'},
                {img:'images/gambleBanner/img_g22.jpg'},
                {img:'images/gambleBanner/img_g23.jpg'},
                {img:'images/gambleBanner/img_g24.jpg'},
                {img:'images/gambleBanner/img_g25.jpg'},
                {img:'images/gambleBanner/img_g26.jpg'},
                {img:'images/gambleBanner/img_g27.jpg'},
                {img:'images/gambleBanner/img_g28.jpg'},
                {img:'images/gambleBanner/img_g29.jpg'},
                {img:'images/gambleBanner/img_g30.jpg'}
            ],
            web:[
                {img:'images/gamebleWeb/pota01.png'},
                {img:'images/gamebleWeb/pota02.png'},
                {img:'images/gamebleWeb/pota03.png'},
                {img:'images/gamebleWeb/pota04.png'},
                {img:'images/gamebleWeb/pota05.png'},
                {img:'images/gamebleWeb/pota06.png'},
                {img:'images/gamebleWeb/pota07.png'},
                {img:'images/gamebleWeb/pota08.png'},
                {img:'images/gamebleWeb/pota09.png'},
                {img:'images/gamebleWeb/pota10.png'},
                {img:'images/gamebleWeb/pota11.png'},
                {img:'images/gamebleWeb/pota12.png'},
                {img:'images/gamebleWeb/pota13.png'},
                {img:'images/gamebleWeb/pota14.png'},
                {img:'images/gamebleWeb/pota15.png'},
                {img:'images/gamebleWeb/pota16.png'},
                {img:'images/gamebleWeb/pota17.png'},
                {img:'images/gamebleWeb/pota18.png'},
                {img:'images/gamebleWeb/pota19.png'},
                {img:'images/gamebleWeb/pota20.png'},
                {img:'images/gamebleWeb/pota21.png'},
                {img:'images/gamebleWeb/pota22.png'},
                {img:'images/gamebleWeb/pota23.png'},
                {img:'images/gamebleWeb/pota24.png'},
                {img:'images/gamebleWeb/pota25.png'},
                {img:'images/gamebleWeb/pota26.png'},
                {img:'images/gamebleWeb/pota27.png'},
                {img:'images/gamebleWeb/pota28.png'},
                {img:'images/gamebleWeb/pota29.png'},
                {img:'images/gamebleWeb/pota30.png'},
                {img:'images/gamebleWeb/pota31.png'},
                {img:'images/gamebleWeb/pota32.png'},
                {img:'images/gamebleWeb/pota33.png'},
                {img:'images/gamebleWeb/pota34.png'},
                {img:'images/gamebleWeb/pota35.png'},
                {img:'images/gamebleWeb/pota36.png'},
                {img:'images/gamebleWeb/pota37.png'},
                {img:'images/gamebleWeb/pota38.png'},
                {img:'images/gamebleWeb/pota39.png'},
                {img:'images/gamebleWeb/pota40.png'},
                {img:'images/gamebleWeb/pota41.png'},
                {img:'images/gamebleWeb/pota42.png'},
                {img:'images/gamebleWeb/pota43.png'},
                {img:'images/gamebleWeb/pota44.png'},
                {img:'images/gamebleWeb/pota45.png'},
                {img:'images/gamebleWeb/pota46.png'},
                {img:'images/gamebleWeb/pota47.png'},
                {img:'images/gamebleWeb/pota48.png'},
                {img:'images/gamebleWeb/pota49.png'},
                {img:'images/gamebleWeb/pota50.png'},
                {img:'images/gamebleWeb/pota51.png'},
                {img:'images/gamebleWeb/pota52.png'},
                {img:'images/gamebleWeb/pota53.png'},
                {img:'images/gamebleWeb/pota54.png'},
                {img:'images/gamebleWeb/pota55.png'},
                {img:'images/gamebleWeb/pota56.png'},
                {img:'images/gamebleWeb/pota57.png'},
                {img:'images/gamebleWeb/pota58.png'},
                {img:'images/gamebleWeb/pota59.png'},
                {img:'images/gamebleWeb/pota60.png'},
                {img:'images/gamebleWeb/pota61.png'},
                {img:'images/gamebleWeb/pota62.png'},
                {img:'images/gamebleWeb/pota63.png'},
                {img:'images/gamebleWeb/pota64.png'},
                {img:'images/gamebleWeb/pota65.png'},
                {img:'images/gamebleWeb/pota66.png'},
                {img:'images/gamebleWeb/pota67.png'},
                {img:'images/gamebleWeb/pota68.png'},
                {img:'images/gamebleWeb/pota69.png'},
                {img:'images/gamebleWeb/pota70.png'},
                {img:'images/gamebleWeb/pota71.png'},
                {img:'images/gamebleWeb/pota72.png'}
            ],
            logo:[
                {img:'images/logo/img_01.jpg'},
                {img:'images/logo/img_02.jpg'},
                {img:'images/logo/img_03.jpg'},
                {img:'images/logo/img_04.jpg'},
                {img:'images/logo/img_05.jpg'},
                {img:'images/logo/img_06.jpg'},
                {img:'images/logo/img_07.jpg'},
                {img:'images/logo/img_08.jpg'},
                {img:'images/logo/img_09.jpg'},
                {img:'images/logo/img_10.jpg'},
                {img:'images/logo/img_11.jpg'},
                {img:'images/logo/img_12.jpg'},
                {img:'images/logo/img_13.jpg'},
                {img:'images/logo/img_14.jpg'},
                {img:'images/logo/img_15.jpg'},
                {img:'images/logo/img_16.jpg'},
                {img:'images/logo/img_17.png'}
            ],
            painter:[
                {img:'images/painter/img_01.jpg'},
                {img:'images/painter/img_02.jpg'},
                {img:'images/painter/img_03.jpg'},
                {img:'images/painter/img_04.jpg'},
                {img:'images/painter/img_05.jpg'},
                {img:'images/painter/img_06.jpg'},
                {img:'images/painter/img_07.jpg'},
                {img:'images/painter/img_08.jpg'},
                {img:'images/painter/img_09.jpg'},
                {img:'images/painter/img_10.jpg'},
                {img:'images/painter/img_11.jpg'},
                {img:'images/painter/img_12.jpg'},
                {img:'images/painter/img_13.jpg'},
                {img:'images/painter/img_14.jpg'},
                {img:'images/painter/img_15.jpg'},
                {img:'images/painter/img_16.jpg'},
                {img:'images/painter/img_17.jpg'}
            ],
            webui:[
                {img:'images/painter/img_01.jpg'},
                {img:'images/painter/img_02.jpg'},
                {img:'images/painter/img_03.jpg'},
                {img:'images/painter/img_04.jpg'},
                {img:'images/painter/img_05.jpg'},
                {img:'images/painter/img_06.jpg'},
                {img:'images/painter/img_07.jpg'},
                {img:'images/painter/img_08.jpg'},
                {img:'images/painter/img_09.jpg'},
                {img:'images/painter/img_10.jpg'},
                {img:'images/painter/img_11.jpg'},
                {img:'images/painter/img_12.jpg'},
                {img:'images/painter/img_13.jpg'},
                {img:'images/painter/img_14.jpg'},
                {img:'images/painter/img_15.jpg'},
                {img:'images/painter/img_16.jpg'},
                {img:'images/painter/img_17.jpg'},
                {img:'images/painter/img_18.jpg'},
                {img:'images/painter/img_19.jpg'},
                {img:'images/painter/img_20.jpg'}
            ],
            active:[
                {img:'images/DM/img_01.jpg'},
                {img:'images/DM/img_02.jpg'},
                {img:'images/DM/img_03.jpg'},
                {img:'images/DM/img_04.jpg'},
                {img:'images/DM/img_05.jpg'},
                {img:'images/DM/img_06.jpg'},
                {img:'images/DM/img_07.jpg'},
                {img:'images/DM/img_08.jpg'},
                {img:'images/DM/img_09.jpg'},
                {img:'images/DM/img_10.jpg'},
                {img:'images/DM/img_11.jpg'},
                {img:'images/DM/img_12.jpg'}
            ],
            appui:[
                {img:'images/appui/img_01.jpg'},
                {img:'images/appui/img_02.jpg'},
                {img:'images/appui/img_03.jpg'},
                {img:'images/appui/img_04.jpg'},
                {img:'images/appui/img_05.jpg'},
                {img:'images/appui/img_06.jpg'},
                {img:'images/appui/img_07.jpg'},
                {img:'images/appui/img_08.jpg'},
                {img:'images/appui/img_09.jpg'},
                {img:'images/appui/img_10.jpg'},
                {img:'images/appui/img_11.jpg'},
                {img:'images/appui/img_12.jpg'},
                {img:'images/appui/img_13.jpg'},
                {img:'images/appui/img_14.jpg'},
                {img:'images/appui/img_15.jpg'},
                // {img:'images/appui/img_16.jpg'},
                {img:'images/appui/img_17.jpg'},
                // {img:'images/appui/img_18.jpg'},
                {img:'images/appui/img_19.jpg'},
                {img:'images/appui/img_20.jpg'},
                {img:'images/appui/img_21.png'},
                {img:'images/appui/img_22.png'},
                {img:'images/appui/img_23.png'},
                {img:'images/appui/img_24.png'},
                {img:'images/appui/img_25.png'},
                {img:'images/appui/img_26.png'}
                // {img:'images/appui/img_27.png'},
                // {img:'images/appui/img_28.png'}

            ],
            ability:[
                {skill:'平台/系統介面設計'},
                {skill:'APP介面設計'},
                {skill:'插畫繪製'},
                {skill:'HMTL5'},
                {skill:'測試流程設計'},
                {skill:'活動企劃/發想'},
                {skill:'專案規劃與管理'}
            ],
            item:[
                {name:'PhotoShop'},
                {name:'AdobeXD'},
                {name:'sublimeText'},
                {name:'Visual StdioCode'},
                {name:'HTML5/CSS3'},
                {name:'JQuery'}
            ],
            experience:[
                {
                    title:'華藝互動科技',
                    duration:'( 2018/11~至今 )',
                    duty:'職務內容',
                    join:'參與過的專案:',
                    item:[
                        {name:'PhotoShop'},
                        {name:'AdobeXD'},
                        {name:'sublimeText'},
                        {name:'Visual StdioCode'},
                        {name:'HTML5/CSS3'},
                        {name:'JQuery'}
                    ],
                    content:[
                        {job:'依客戶的需求製作對應的網站版型'},
                        {job:'製作手遊介面以及美術元件設計'},
                        {job:'製作網頁元件以及動態效果'},
                        {job:'繪製美術場景圖、廣告素材圖片'}
                    ]
                },
                {
                    title:'富及數位互動-專案經理',
                    duration:'( 2016/09~2018/10 )',
                    duty:'職務內容',
                    join:'參與過的專案:',
                    item:[
                        {name:'PhotoShop'},
                        {name:'AdobeXD'},
                        {name:'sublimeText'},
                        {name:'Visual StdioCode'},
                        {name:'HTML5/CSS3'},
                        {name:'JQuery'}
                    ],
                    content:[
                        {job:'參與產品的UI規劃與設計'},
                        {job:'平台及活動網頁的製作'},
                        {job:'與後端人員配合建立後台管理系統'},
                        {job:'專案時程規劃與執行'},
                        {job:'人力資源的安排與執行'},
                        {job:'專案測試程序相關的規劃與執行'}
                    ],
                    project:[
                        {goal:'富家匯APP開發'},
                        {goal:'富家保APP開發'},
                        {goal:'APP後臺管理系統'},
                        {goal:'平台相關文宣/海報設計'},
                        {goal:'昀曦科技官方網站'},
                        {goal:'富及數位互動公司官網'},
                        {goal:'薄提詩面膜販售平台'}
                    ]
                },
                {
                    title:'名漢科技-UI設計師',
                    duration:'( 2015/04~2016/8 )',
                    duty:'職務內容',
                    join:'參與過的專案:',
                    item:[
                        {name:'PhotoShop'},
                        {name:'AdobeXD'},
                        {name:'sublimeText'},
                        {name:'Visual StdioCode'},
                        {name:'HTML5/CSS3'},
                        {name:'JQuery'}
                    ],
                    content:[
                        {job:'參與產品的UI規劃與設計'},
                        {job:'平台及活動網頁的製作'},
                        {job:'與後端人員配合建立後台管理系統'},
                        {job:'專案時程規劃與執行'},
                        {job:'人力資源的安排與執行'},
                        {job:'專案測試程序相關的規劃與執行'}
                    ],
                    project:[
                        {goal:'GV001點歌機'},
                        {goal:'KTV娛樂平台系統'},
                        {goal:'K歌評分系統'},
                        {goal:'智慧e-link APP'}
                    ]
                },
                {
                    title:'創赫數位-PM/網頁設計師',
                    duration:'( 2014/02~2014/10 )',
                    duty:'職務內容',
                    join:'參與過的專案:',
                    item:[
                        {name:'PhotoShop'},
                        {name:'AdobeXD'},
                        {name:'sublimeText'},
                        {name:'Visual StdioCode'},
                        {name:'HTML5/CSS3'},
                        {name:'JQuery'}
                    ],
                    content:[
                        {job:'視覺設計、產品企劃討論'},
                        {job:'人力資源的安排與執行'},
                        {job:'專案時程規劃與執行'},
                        {job:'專案測試程序相關的規劃與執行'}
                    ],
                    project:[
                        {goal:'Early Plan平台'},
                        {goal:'Early Plan APP'}
                    ]
                },
                {
                    title:'台達電子UI設計師',
                    duration:'( 2011/01~2013/08 )',
                    duty:'職務內容',
                    join:'參與過的專案:',
                    item:[
                        {name:'PhotoShop'},
                        {name:'AdobeXD'},
                        {name:'sublimeText'},
                        {name:'Visual StdioCode'},
                        {name:'HTML5/CSS3'},
                        {name:'JQuery'}
                    ],
                    content:[
                        {job:'APP、Web UI/UX'},
                        {job:'視覺設計、產品企劃討論'},
                        {job:'協助團隊完善用戶在產品的使用體驗'},
                        {job:'協助智慧電錶測試&撰寫測試報告'},
                        {job:'收集用戶回饋並優化產品'}
                    ],
                    project:[
                        {goal:'海寧皮革城Dash board設計'},
                        {goal:'中國東莞能源在線系統介面設計'},
                        {goal:'IBEMS 能源管理系統介面開發'},
                        {goal:'屏東太陽能監測系統介面設計'},
                        {goal:'高樹太陽能監測系統介面設計'},
                        {goal:'里港太陽能監測系統介面設計'},
                        {goal:'硬體效能測試以及測試報告撰寫'},
                        {goal:'專案測試相關的規劃與執行'}
                    ]
                }
            ]
        }
    }
}).mount('#app');